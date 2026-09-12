package com.everyday.backend.episode;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Immutable authored content only; never stores a buyer's episode progress or messages. */
@Service
@Profile("!baseline")
public class MarketEpisodeCatalog {
    private final JdbcTemplate db;
    public MarketEpisodeCatalog(JdbcTemplate db) { this.db = db; }

    public void importPackage(String listingId, JsonNode episodes) {
        for (JsonNode episode : episodes) {
            String packageId = episode.path("id").asText();
            String code = listingId + ":" + packageId;
            String title = episode.path("title").asText();
            String setting = episode.path("setting").asText();
            db.update("""
                INSERT INTO everyday.episodes(code,title,description,scene_prompt_seed,created_at,updated_at)
                VALUES(?,?,?,?,now(),now()) ON CONFLICT(code) DO NOTHING
                """, code, title, setting.substring(0, Math.min(setting.length(), 500)), setting);
            Long id = db.queryForObject("SELECT id FROM everyday.episodes WHERE code=?", Long.class, code);
            db.update("""
                INSERT INTO everyday.market_episode_templates(listing_id,package_episode_id,episode_id)
                VALUES(?,?,?) ON CONFLICT(listing_id,package_episode_id) DO NOTHING
                """, listingId, packageId, id);
        }
    }

    public List<Long> genericIds() {
        return db.queryForList("SELECT id FROM everyday.episodes WHERE id NOT IN (SELECT episode_id FROM everyday.market_episode_templates) ORDER BY id", Long.class);
    }

    public List<Long> forCharacter(Long characterId) {
        var ids = db.queryForList("""
            SELECT t.episode_id FROM everyday.market_episode_templates t
            JOIN everyday.licensed_characters l ON l.listing_id=t.listing_id
            WHERE l.character_id=? ORDER BY t.episode_id
            """, Long.class, characterId);
        return ids.isEmpty() ? genericIds() : ids;
    }

    public boolean allowed(Long characterId, Long episodeId) {
        return Boolean.TRUE.equals(db.queryForObject("""
            SELECT NOT EXISTS(SELECT 1 FROM everyday.market_episode_templates WHERE episode_id=?)
                OR EXISTS(SELECT 1 FROM everyday.market_episode_templates t
                    JOIN everyday.licensed_characters l ON l.listing_id=t.listing_id
                    WHERE t.episode_id=? AND l.character_id=?)
            """, Boolean.class, episodeId, episodeId, characterId));
    }
}
