-- Standalone server counterpart of shared/utils/smartSearch.ts.
-- Additive, no extension dependency. PostgreSQL 16 ICU supplies locale-independent Unicode.
CREATE COLLATION IF NOT EXISTS autexa_search_unicode (provider=icu,locale='und',deterministic=true);
-- Tenant/point/role predicates remain in callers.
CREATE OR REPLACE FUNCTION autexa_search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(replace(lower(normalize(coalesce(value,''),NFKC) COLLATE autexa_search_unicode),'ё','е'),'[^[:alnum:]]+',' ','g'))
$$;

CREATE OR REPLACE FUNCTION autexa_search_rank(query text, fields text[]) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN query='' THEN 2
    WHEN EXISTS (SELECT 1 FROM unnest(fields) value WHERE value=query OR replace(value,' ','')=replace(query,' ','')) THEN 0
    WHEN EXISTS (SELECT 1 FROM unnest(fields) value WHERE starts_with(value,query) OR starts_with(replace(value,' ',''),replace(query,' ',''))) THEN 1
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(query,' ')) token
       WHERE NOT EXISTS (SELECT 1 FROM unnest(fields) value WHERE position(token IN value)>0 OR position(token IN replace(value,' ',''))>0)
    ) THEN 2
  END
$$;

CREATE OR REPLACE FUNCTION autexa_search_one_edit(left_word text, right_word text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE i integer := 1; ll integer := char_length(left_word); rl integer := char_length(right_word);
BEGIN
  IF abs(ll-rl)>1 OR ll>64 OR rl>64 THEN RETURN false; END IF;
  WHILE i<=least(ll,rl) AND substr(left_word,i,1)=substr(right_word,i,1) LOOP i:=i+1; END LOOP;
  IF i>ll AND i>rl THEN RETURN true; END IF;
  IF ll<rl THEN RETURN substr(left_word,i)=substr(right_word,i+1); END IF;
  IF ll>rl THEN RETURN substr(left_word,i+1)=substr(right_word,i); END IF;
  IF substr(left_word,i+1)=substr(right_word,i+1) THEN RETURN true; END IF;
  RETURN substr(left_word,i,1)=substr(right_word,i+1,1)
     AND substr(left_word,i+1,1)=substr(right_word,i,1)
     AND substr(left_word,i+2)=substr(right_word,i+2);
END
$$;

CREATE OR REPLACE FUNCTION autexa_search_typo_matches(query text, fields text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT query<>'' AND query COLLATE autexa_search_unicode !~ '[[:digit:]]' AND cardinality(ARRAY(SELECT DISTINCT token FROM unnest(string_to_array(query,' ')) token))<=8
    AND NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(query,' ')) token
      WHERE NOT EXISTS (SELECT 1 FROM unnest(fields) value WHERE position(token IN value)>0 OR position(token IN replace(value,' ',''))>0)
        AND NOT (token COLLATE autexa_search_unicode ~ '^[[:alpha:]]{4,64}$' AND EXISTS (
          -- Bound fuzzy candidates per field; ordinary substring search always covers the complete value.
          SELECT 1 FROM unnest(fields) value
          CROSS JOIN LATERAL unnest(string_to_array(value,' ')) WITH ORDINALITY word(value,position)
          WHERE word.position<=128 AND word.value COLLATE autexa_search_unicode ~ '^[[:alpha:]]{1,64}$'
            AND abs(char_length(token)-char_length(word.value))<=1
            AND autexa_search_one_edit(token,word.value)
        ))
    )
$$;
