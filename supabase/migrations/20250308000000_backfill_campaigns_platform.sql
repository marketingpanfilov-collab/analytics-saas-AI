-- Backfill campaigns.platform from existing account mappings.
-- Runtime schema: campaigns.ad_account_id stores external account id (text);
-- match to ad_accounts via ad_accounts.external_account_id = campaigns.ad_account_id.
-- Run once to fill platform for existing rows where platform is null.

UPDATE campaigns c
SET platform = aa.provider
FROM ad_accounts aa
WHERE aa.external_account_id = c.ad_account_id
  AND c.platform IS NULL;
