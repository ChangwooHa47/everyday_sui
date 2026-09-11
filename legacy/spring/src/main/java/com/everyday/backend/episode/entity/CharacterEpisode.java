package com.everyday.backend.episode.entity;

import com.everyday.backend.common.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 캐릭터별 에피소드 진행 상태. characterId는 character 패키지 의존을 피하기 위해 단순 컬럼으로 둔다. */
@Getter
@Entity
@Table(name = "character_episodes")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CharacterEpisode extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long characterId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "episode_id", nullable = false)
    private Episode episode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EpisodeStatus status;

    @Builder
    public CharacterEpisode(Long characterId, Episode episode, EpisodeStatus status) {
        this.characterId = characterId;
        this.episode = episode;
        this.status = status;
    }
}
