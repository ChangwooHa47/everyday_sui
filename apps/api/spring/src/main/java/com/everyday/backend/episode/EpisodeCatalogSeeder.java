package com.everyday.backend.episode;

import com.everyday.backend.episode.entity.Episode;
import com.everyday.backend.episode.repository.EpisodeRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/** 데모 실행 시 에피소드 카탈로그가 비어 있으면 기본 3종을 채운다. */
@Component
public class EpisodeCatalogSeeder implements CommandLineRunner {

    private final EpisodeRepository episodeRepository;

    public EpisodeCatalogSeeder(EpisodeRepository episodeRepository) {
        this.episodeRepository = episodeRepository;
    }

    @Override
    public void run(String... args) {
        if (episodeRepository.count() > 0) {
            return;
        }

        episodeRepository.save(Episode.builder()
                .code("FIRST_DATE")
                .title("첫 데이트")
                .emoji("☕")
                .description("카페에 마주앉은 두 사람, 어색한 침묵이 흐른다")
                .scenePromptSeed("두 사람은 카페에 마주앉아 첫 데이트를 시작했다. 어색한 침묵이 흐르는 상황이다. "
                        + "이 분위기를 캐릭터답게 자연스럽게 풀어나가.")
                .build());

        episodeRepository.save(Episode.builder()
                .code("NIGHT_WALK")
                .title("밤 산책")
                .emoji("🌙")
                .description("밤 11시, 한강 공원. 시원한 바람이 불고 있다")
                .scenePromptSeed("밤 11시 한강 공원을 함께 산책하는 상황이다. 시원한 바람이 불고 분위기가 편안하다. "
                        + "이 상황에 맞게 대화를 이어가.")
                .build());

        episodeRepository.save(Episode.builder()
                .code("AFTER_FIGHT")
                .title("싸운 다음 날")
                .emoji("🌧️")
                .description("어제 사소한 일로 다퉜다. 하루 종일 연락이 없었다")
                .scenePromptSeed("어제 사소한 일로 다툰 다음 날이다. 하루 종일 연락이 없었던 상황이다. "
                        + "서운함과 화해하고 싶은 마음이 섞인 캐릭터의 감정을 자연스럽게 표현해.")
                .build());
    }
}
