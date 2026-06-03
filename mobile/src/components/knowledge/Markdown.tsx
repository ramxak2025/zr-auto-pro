/**
 * Markdown — a small, dependency-free markdown renderer for the Knowledge
 * Base reader.
 *
 * WHY in-house (not react-native-markdown-display):
 *   That library is effectively unmaintained, declares React ^16/17/18 peer
 *   ranges, and pulls a chain of transitive deps (markdown-it, css-to-rn) that
 *   repeatedly mis-resolve on RN 0.81 / React 19 / New Arch. The repo has been
 *   bitten by exactly this class of dependency landmine before (expo-audio →
 *   expo-asset@56 launch crash). For owner-authored internal content we only
 *   need a stable, well-known subset — so we render it ourselves and keep the
 *   `expo export` bundle clean and native-module-free.
 *
 * Supported subset (block + inline):
 *   • Headings:  #  ##  ###            → title2 / title3 / callout
 *   • Unordered lists:  - x  /  * x  /  + x
 *   • Ordered lists:  1. x  2. x
 *   • Blockquotes:  > x
 *   • Horizontal rule:  ---  /  ***
 *   • Images:  ![alt](url)             (whole-line)
 *   • Paragraphs + blank-line separation + single line breaks
 *   • Inline:  **bold**  __bold__  *italic*  _italic_  `code`  [text](url)
 *
 * Everything is typed through our <Text> variants and the theme palette, so it
 * inherits the app's typography automatically. Unknown syntax degrades to plain
 * text — never throws, never leaves raw markers dangling badly.
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import CachedImage from '../CachedImage';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { getImageUrl } from '../../api/axios';
import { haptic } from '../../platform/haptics';

type Palette = ReturnType<typeof useColors>;

// ── Inline parsing ────────────────────────────────────────────────────────
// Token types the inline tokenizer emits.
type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

// A single regex scans for the first markup occurrence; the surrounding
// plain text is emitted as `text`. Order matters: links + images first (they
// contain brackets), then code, bold, italic. Greedy-safe with lazy groups.
const INLINE_RE =
  /(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*]+)\*|_([^_]+)_)/;

function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = input;
  // Guard against pathological inputs — cap iterations.
  let guard = 0;
  while (rest.length > 0 && guard < 5000) {
    guard += 1;
    const m = INLINE_RE.exec(rest);
    if (!m || m.index === undefined) {
      tokens.push({ kind: 'text', text: rest });
      break;
    }
    if (m.index > 0) {
      tokens.push({ kind: 'text', text: rest.slice(0, m.index) });
    }
    if (m[1]) {
      // [text](href)
      tokens.push({ kind: 'link', text: m[2], href: m[3] });
    } else if (m[4]) {
      // `code`
      tokens.push({ kind: 'code', text: m[5] });
    } else if (m[6]) {
      // **bold** / __bold__
      tokens.push({ kind: 'bold', text: m[7] ?? m[8] ?? '' });
    } else if (m[9]) {
      // *italic* / _italic_
      tokens.push({ kind: 'italic', text: m[10] ?? m[11] ?? '' });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return tokens;
}

function openLink(href: string) {
  haptic('tap');
  const url = href.startsWith('http://') || href.startsWith('https://') ? href : `https://${href}`;
  Linking.openURL(url).catch(() => {});
}

function Inline({ text, palette, baseColor }: { text: string; palette: Palette; baseColor: string }) {
  const tokens = React.useMemo(() => tokenizeInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case 'bold':
            return (
              <Text key={i} variant="bodyEmph" style={{ fontWeight: '700', color: baseColor }}>
                {t.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={i} variant="body" style={{ fontStyle: 'italic', color: baseColor }}>
                {t.text}
              </Text>
            );
          case 'code':
            return (
              <Text
                key={i}
                variant="mono"
                style={{
                  color: palette.accent.primaryText,
                  backgroundColor: palette.bg.muted,
                }}
              >
                {' '}
                {t.text}{' '}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                variant="body"
                onPress={() => openLink(t.href)}
                style={{ color: palette.accent.primary, textDecorationLine: 'underline' }}
              >
                {t.text}
              </Text>
            );
          default:
            return (
              <Text key={i} variant="body" style={{ color: baseColor }}>
                {t.text}
              </Text>
            );
        }
      })}
    </>
  );
}

// ── Block parsing ─────────────────────────────────────────────────────────
interface MarkdownProps {
  /** Raw markdown text. */
  content: string;
}

const IMG_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const ULIST_RE = /^[-*+]\s+(.*)$/;
const OLIST_RE = /^(\d+)\.\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^>\s?(.*)$/;

export default function Markdown({ content }: MarkdownProps) {
  const palette = useColors();
  const blocks = React.useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content]);
  const baseColor = palette.text.secondary;

  const nodes: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n');
    nodes.push(
      <Text key={`p${key++}`} variant="body" style={[styles.paragraph, { color: baseColor }]}>
        <Inline text={text} palette={palette} baseColor={baseColor} />
      </Text>,
    );
    paragraph = [];
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const line = blocks[i];
    const trimmed = line.trimEnd();

    if (trimmed.trim() === '') {
      flushParagraph();
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(trimmed.trim())) {
      flushParagraph();
      nodes.push(<View key={`hr${key++}`} style={[styles.hr, { backgroundColor: palette.border.subtle }]} />);
      continue;
    }

    // Headings
    const h3 = trimmed.match(/^###\s+(.*)$/);
    const h2 = trimmed.match(/^##\s+(.*)$/);
    const h1 = trimmed.match(/^#\s+(.*)$/);
    if (h1 || h2 || h3) {
      flushParagraph();
      if (h1) {
        nodes.push(
          <Text key={`h${key++}`} variant="title2" color={palette.text.primary} style={styles.h1}>
            <Inline text={h1[1]} palette={palette} baseColor={palette.text.primary} />
          </Text>,
        );
      } else if (h2) {
        nodes.push(
          <Text key={`h${key++}`} variant="title3" color={palette.text.primary} style={styles.h2}>
            <Inline text={h2[1]} palette={palette} baseColor={palette.text.primary} />
          </Text>,
        );
      } else if (h3) {
        nodes.push(
          <Text key={`h${key++}`} variant="callout" color={palette.text.primary} style={styles.h3}>
            <Inline text={h3[1]} palette={palette} baseColor={palette.text.primary} />
          </Text>,
        );
      }
      continue;
    }

    // Whole-line image
    const img = trimmed.match(IMG_LINE_RE);
    if (img) {
      flushParagraph();
      const uri = getImageUrl(img[2]);
      if (uri) {
        nodes.push(
          <CachedImage
            key={`img${key++}`}
            source={{ uri }}
            style={[styles.image, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            resizeMode="cover"
          />,
        );
      }
      continue;
    }

    // Blockquote
    const quote = trimmed.match(QUOTE_RE);
    if (quote) {
      flushParagraph();
      nodes.push(
        <View key={`q${key++}`} style={[styles.quote, { borderLeftColor: palette.accent.primary }]}>
          <Text variant="body" style={{ color: palette.text.secondary, fontStyle: 'italic' }}>
            <Inline text={quote[1]} palette={palette} baseColor={palette.text.secondary} />
          </Text>
        </View>,
      );
      continue;
    }

    // Lists — consume a contiguous run so adjacent items group together.
    const ul = trimmed.match(ULIST_RE);
    const ol = trimmed.match(OLIST_RE);
    if (ul || ol) {
      flushParagraph();
      const items: { marker: string; text: string }[] = [];
      let j = i;
      let ordinal = ol ? parseInt(ol[1], 10) : 1;
      while (j < blocks.length) {
        const ln = blocks[j].trimEnd();
        const mUl = ln.match(ULIST_RE);
        const mOl = ln.match(OLIST_RE);
        if (mUl) {
          items.push({ marker: '•', text: mUl[1] });
        } else if (mOl) {
          items.push({ marker: `${ordinal}.`, text: mOl[2] });
          ordinal += 1;
        } else {
          break;
        }
        j += 1;
      }
      i = j - 1;
      nodes.push(
        <View key={`list${key++}`} style={styles.list}>
          {items.map((it, idx) => (
            <View key={idx} style={styles.listItem}>
              <Text variant="body" style={[styles.listMarker, { color: palette.accent.primary }]}>
                {it.marker}
              </Text>
              <Text variant="body" style={[styles.listText, { color: baseColor }]}>
                <Inline text={it.text} palette={palette} baseColor={baseColor} />
              </Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }

    // Default — accumulate into a paragraph.
    paragraph.push(trimmed);
  }
  flushParagraph();

  return <View style={styles.root}>{nodes}</View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing[2] },
  paragraph: { lineHeight: 23 },
  h1: { marginTop: spacing[3], marginBottom: spacing[1] },
  h2: { marginTop: spacing[3], marginBottom: spacing[1] },
  h3: { marginTop: spacing[2.5], marginBottom: spacing[0.5] },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: spacing[3] },
  image: {
    width: '100%',
    height: 200,
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: spacing[1],
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: spacing[3],
    paddingVertical: spacing[1],
    marginVertical: spacing[1],
  },
  list: { gap: spacing[1.5], marginVertical: spacing[1] },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  listMarker: { minWidth: 18, lineHeight: 23, fontWeight: '600' },
  listText: { flex: 1, lineHeight: 23 },
});
