package com.everyday.backend.episode.service;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.chat.dto.ChatMessageResponse;
import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.episode.dto.EpisodeResponse;
import com.everyday.backend.episode.dto.EpisodeStartResponse;
import com.everyday.backend.episode.entity.CharacterEpisode;
import com.everyday.backend.episode.entity.Episode;
import com.everyday.backend.episode.entity.EpisodeStatus;
import com.everyday.backend.episode.repository.CharacterEpisodeRepository;
import com.everyday.backend.episode.repository.EpisodeRepository;
import com.everyday.backend.llm.LlmClient;
import com.everyday.backend.llm.LlmMessage;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class EpisodeService {

    private static final int MAX_CONTEXT_MESSAGES = 10;
    private static final int STARTER_COUNT = 2;

    private final EpisodeRepository episodeRepository;
    private final CharacterEpisodeRepository characterEpisodeRepository;
    private final CharacterRepository characterRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final LlmClient llmClient;
    private final ObjectMapper objectMapper;

    public EpisodeService(EpisodeRepository episodeRepository, CharacterEpisodeRepository characterEpisodeRepository,
            CharacterRepository characterRepository, ChatMessageRepository chatMessageRepository,
            LlmClient llmClient, ObjectMapper objectMapper) {
        this.episodeRepository = episodeRepository;
        this.characterEpisodeRepository = characterEpisodeRepository;
        this.characterRepository = characterRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.llmClient = llmClient;
        this.objectMapper = objectMapper;
    }

    public List<EpisodeResponse> list() {
        return episodeRepository.findAll().stream().map(EpisodeResponse::from).toList();
    }

    @Transactional
    public EpisodeStartResponse start(Long userId, Long characterId, Long episodeId) {
        Character character = getOwnedCharacter(userId, characterId);
        Episode episode = episodeRepository.findById(episodeId)
                .orElseThrow(() -> new CustomException(ErrorCode.EPISODE_NOT_FOUND));

        CharacterEpisode characterEpisode = characterEpisodeRepository
                .findByCharacterIdAndEpisodeId(characterId, episodeId)
                .orElseGet(() -> characterEpisodeRepository.save(CharacterEpisode.builder()
                        .characterId(characterId)
                        .episode(episode)
                        .status(EpisodeStatus.IN_PROGRESS)
                        .build()));

        List<String> starters = generateStarters(character, episode);

        return new EpisodeStartResponse(
                characterEpisode.getId(), episode.getTitle(), episode.getEmoji(), episode.getDescription(),
                characterEpisode.getStatus().name(), starters);
    }

    @Transactional
    public List<ChatMessageResponse> getMessages(Long userId, Long characterId, Long episodeId) {
        getOwnedCharacter(userId, characterId);
        CharacterEpisode characterEpisode = getCharacterEpisode(characterId, episodeId);

        return chatMessageRepository
                .findAllByCharacterIdAndCharacterEpisodeIdOrderByCreatedAtAsc(characterId, characterEpisode.getId())
                .stream()
                .map(ChatMessageResponse::from)
                .toList();
    }

    @Transactional
    public ChatMessageResponse sendMessage(Long userId, Long characterId, Long episodeId, String content) {
        Character character = getOwnedCharacter(userId, characterId);
        CharacterEpisode characterEpisode = getCharacterEpisode(characterId, episodeId);
        Episode episode = characterEpisode.getEpisode();

        chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .characterEpisodeId(characterEpisode.getId())
                .sender(MessageSender.USER)
                .content(content)
                .build());

        List<ChatMessage> all = chatMessageRepository.findAllByCharacterIdAndCharacterEpisodeIdOrderByCreatedAtAsc(
                characterId, characterEpisode.getId());
        int fromIndex = Math.max(0, all.size() - MAX_CONTEXT_MESSAGES);
        List<LlmMessage> context = all.subList(fromIndex, all.size()).stream()
                .map(m -> m.getSender() == MessageSender.USER
                        ? LlmMessage.user(m.getContent())
                        : LlmMessage.assistant(m.getContent()))
                .toList();

        String episodeSystemPrompt = character.getSystemPrompt()
                + "\n\n[현재 에피소드 상황]\n" + episode.getScenePromptSeed();
        String aiReply = llmClient.generate(episodeSystemPrompt, context);

        ChatMessage aiMessage = chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .characterEpisodeId(characterEpisode.getId())
                .sender(MessageSender.AI)
                .content(aiReply)
                .build());

        return ChatMessageResponse.from(aiMessage);
    }

    private List<String> generateStarters(Character character, Episode episode) {
        String systemPrompt = """
                너는 사용자가 특정 상황극(에피소드)에서 캐릭터에게 먼저 건넬 수 있는 짧고 자연스러운
                한국어 대화 시작 문장을 추천해주는 도우미야. 반드시 아래 JSON 배열 형식으로만 응답하고
                그 외 텍스트는 포함하지 마라: ["문장1", "문장2"]
                """;
        String context = "캐릭터 이름: " + character.getName()
                + "\n에피소드 상황: " + episode.getDescription()
                + "\n시나리오: " + episode.getScenePromptSeed();

        String raw = llmClient.generate(systemPrompt, List.of(LlmMessage.user(context)));
        try {
            List<String> starters = objectMapper.readValue(stripCodeFence(raw), new TypeReference<List<String>>() {
            });
            return starters.stream().limit(STARTER_COUNT).toList();
        } catch (Exception e) {
            return List.of("안녕, 오랜만이야.", "오늘 여기서 보니까 반갑다.");
        }
    }

    private String stripCodeFence(String raw) {
        String trimmed = raw.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```[a-zA-Z]*\\n", "");
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3);
            }
        }
        return trimmed.trim();
    }

    private CharacterEpisode getCharacterEpisode(Long characterId, Long episodeId) {
        return characterEpisodeRepository.findByCharacterIdAndEpisodeId(characterId, episodeId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_EPISODE_NOT_FOUND));
    }

    private Character getOwnedCharacter(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }
        return character;
    }
}
