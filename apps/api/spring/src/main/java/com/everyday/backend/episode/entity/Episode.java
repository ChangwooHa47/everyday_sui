package com.everyday.backend.episode.entity;

import com.everyday.backend.common.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 에피소드 카탈로그(시드 데이터). 사용자별 진행 상태는 CharacterEpisode가 갖는다.
 */
@Getter
@Entity
@Table(name = "episodes")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Episode extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String title;

    private String emoji;

    @Column(nullable = false, length = 500)
    private String description;

    /** 에피소드 진행 중 LLM에게 상황을 알려주기 위한 시나리오 지시문 */
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.LONGVARCHAR)
    private String scenePromptSeed;

    @Builder
    public Episode(String code, String title, String emoji, String description, String scenePromptSeed) {
        this.code = code;
        this.title = title;
        this.emoji = emoji;
        this.description = description;
        this.scenePromptSeed = scenePromptSeed;
    }
}
