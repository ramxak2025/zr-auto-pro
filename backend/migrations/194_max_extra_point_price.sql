-- Only the canonical MAX plan's old default rate changes; preserve custom rates.
UPDATE plans
SET extra_point_monthly_price = 3000
WHERE id = '16100000-0000-4000-a000-000000000003'
  AND code = 'max'
  AND extra_point_monthly_price = 5000;
