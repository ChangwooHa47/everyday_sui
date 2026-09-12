-- Public aggregate only: no user IDs, message content or personal memory leaves this view.
CREATE VIEW everyday.market_engagement AS
WITH per_reader AS (
  SELECT l.listing_id,c.user_id,count(m.id) AS turns,count(DISTINCT m.created_at::date) AS days
  FROM everyday.licensed_characters l
  JOIN everyday.characters c ON c.id=l.character_id
  JOIN everyday.chat_messages m ON m.character_id=c.id AND m.sender='USER'
  GROUP BY l.listing_id,c.user_id
)
SELECT listing_id,sum(turns)::bigint AS turns,count(*)::bigint AS readers,
       count(*) FILTER (WHERE days>1)::bigint AS returning_readers
FROM per_reader GROUP BY listing_id;
