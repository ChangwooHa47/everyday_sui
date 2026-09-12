package com.everyday.backend.episode.service;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.chat.dto.ChatMessageResponse;
import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.chat.service.ConversationContext;
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

    private final com.everyday.backend.character.service.MarketProductService marketProducts;


    private static final int STARTER_COUNT = 2;

    private final EpisodeRepository episodeRepository;
    private final CharacterEpisodeRepository characterEpisodeRepository;
    private final CharacterRepository characterRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final LlmClient llmClient;
    private final ObjectMapper objectMapper;
    private final com.everyday.backend.episode.MarketEpisodeCatalog catalog;
    private final com.everyday.backend.chat.service.ChatTurnRequests turns;
    private final com.everyday.backend.episode.EpisodeStarterRequests starterRequests;
    private final ConversationContext conversationContext;
    private final org.springframework.transaction.support.TransactionTemplate transaction;

    public EpisodeService(EpisodeRepository episodeRepository, CharacterEpisodeRepository characterEpisodeRepository,
            CharacterRepository characterRepository, ChatMessageRepository chatMessageRepository,
            LlmClient llmClient, ObjectMapper objectMapper, com.everyday.backend.character.service.MarketProductService marketProducts,
            org.springframework.beans.factory.ObjectProvider<com.everyday.backend.episode.MarketEpisodeCatalog> catalog,
            org.springframework.beans.factory.ObjectProvider<com.everyday.backend.chat.service.ChatTurnRequests> turns,
            org.springframework.beans.factory.ObjectProvider<com.everyday.backend.episode.EpisodeStarterRequests> starterRequests,
            ConversationContext conversationContext,
            org.springframework.transaction.PlatformTransactionManager manager) {
        this.marketProducts = marketProducts;
        this.episodeRepository = episodeRepository;
        this.characterEpisodeRepository = characterEpisodeRepository;
        this.characterRepository = characterRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.llmClient = llmClient;
        this.objectMapper = objectMapper;
        this.catalog = catalog.getIfAvailable();
        this.turns = turns.getIfAvailable();
        this.starterRequests = starterRequests.getIfAvailable();
        this.conversationContext = conversationContext;
        this.transaction = new org.springframework.transaction.support.TransactionTemplate(manager);
    }

    public List<EpisodeResponse> list() {
        return (catalog == null ? episodeRepository.findAll() : episodeRepository.findAllById(catalog.genericIds()))
                .stream().map(EpisodeResponse::from).toList();
    }

    public List<EpisodeResponse> list(Long userId, Long characterId) {
        getOwnedCharacter(userId, characterId);
        return (catalog == null ? episodeRepository.findAll() : episodeRepository.findAllById(catalog.forCharacter(characterId)))
                .stream().map(EpisodeResponse::from).toList();
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public EpisodeStartResponse start(Long userId, Long characterId, Long episodeId) {
        Character character = getOwnedCharacter(userId, characterId);
        requireEpisodeAccess(characterId, episodeId);
        Episode episode = episodeRepository.findById(episodeId)
                .orElseThrow(() -> new CustomException(ErrorCode.EPISODE_NOT_FOUND));
        CharacterEpisode characterEpisode = transaction.execute(tx -> {
            characterRepository.findForUpdateById(characterId).orElseThrow();
            return characterEpisodeRepository
                .findByCharacterIdAndEpisodeId(characterId, episodeId)
                .orElseGet(() -> characterEpisodeRepository.save(CharacterEpisode.builder()
                        .characterId(characterId)
                        .episode(episode)
                        .status(EpisodeStatus.IN_PROGRESS)
                        .build()));
        });
        List<String> starters = starterRequests == null ? null : starterRequests.claim(characterEpisode.getId());
        if (starters == null) {
            boolean providerStarted = false;
            try {
                llmClient.requireConfigured();
                providerStarted = true;
                starters = generateStarters(character, episode);
                if (starterRequests != null) starterRequests.complete(characterEpisode.getId(), starters);
            } catch (RuntimeException error) {
                if (!providerStarted && starterRequests != null) starterRequests.releaseBeforeProvider(characterEpisode.getId());
                throw error;
            }
        }

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

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public ChatMessageResponse sendMessage(Long userId, Long characterId, Long episodeId, String content, java.util.UUID requestId) {
        getOwnedCharacter(userId, characterId);
        requireEpisodeAccess(characterId, episodeId);
        CharacterEpisode characterEpisode = getCharacterEpisode(characterId, episodeId);
        Long existing = turns == null ? null : turns.claim(requestId, characterId, characterEpisode.getId(), content);
        if (existing != null) return ChatMessageResponse.from(chatMessageRepository.findById(existing).orElseThrow());
        var providerStarted = new java.util.concurrent.atomic.AtomicBoolean();
        try {
        return transaction.execute(tx -> {
        // Serialize user/assistant pairs just like ordinary chat, including concurrent tabs.
        Character character = characterRepository.findForUpdateById(characterId).orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        Episode episode = episodeRepository.findById(episodeId).orElseThrow(() -> new CustomException(ErrorCode.EPISODE_NOT_FOUND));

        chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .characterEpisodeId(characterEpisode.getId())
                .sender(MessageSender.USER)
                .content(content)
                .build());

        List<LlmMessage> context = conversationContext.forEpisode(characterId, characterEpisode.getId());

        String episodeSystemPrompt = character.getSystemPrompt()
                + "\n\n[현재 에피소드 상황]\n" + episode.getScenePromptSeed();
        episodeSystemPrompt = marketProducts.withApprovedMemory(characterId, episodeSystemPrompt, content);
        llmClient.requireConfigured();
        providerStarted.set(true);
        String aiReply = llmClient.generate(episodeSystemPrompt, context);

        ChatMessage aiMessage = chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .characterEpisodeId(characterEpisode.getId())
                .sender(MessageSender.AI)
                .content(aiReply)
                .build());

        if (turns != null) turns.complete(requestId, aiMessage.getId());
        return ChatMessageResponse.from(aiMessage);
        });
        } catch (RuntimeException error) {
            if (!providerStarted.get() && turns != null) turns.releaseBeforeProvider(requestId);
            throw error;
        }
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
            if (starters == null || starters.size() < STARTER_COUNT || starters.stream().anyMatch(s -> s == null || s.isBlank() || s.length() > 500))
                throw new IllegalArgumentException("Invalid generated starters");
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
        requireEpisodeAccess(characterId, episodeId);
        return characterEpisodeRepository.findByCharacterIdAndEpisodeId(characterId, episodeId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_EPISODE_NOT_FOUND));
    }

    private void requireEpisodeAccess(Long characterId, Long episodeId) {
        if (catalog != null && !catalog.allowed(characterId, episodeId))
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
    }

    private Character getOwnedCharacter(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }
        marketProducts.requireAccess(characterId);
        return character;
    }
}
