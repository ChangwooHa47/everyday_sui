package com.everyday.backend.photo.service;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.image.ImageClient;
import com.everyday.backend.llm.LlmClient;
import com.everyday.backend.llm.LlmMessage;
import com.everyday.backend.photo.dto.GeneratePhotoRequest;
import com.everyday.backend.photo.dto.PhotoConceptResponse;
import com.everyday.backend.photo.dto.PhotoGenerationResponse;
import com.everyday.backend.photo.dto.PhotoResponse;
import com.everyday.backend.photo.entity.Photo;
import com.everyday.backend.photo.entity.PhotoConcept;
import com.everyday.backend.photo.entity.PhotoType;
import com.everyday.backend.photo.repository.PhotoRepository;
import com.everyday.backend.user.entity.User;
import com.everyday.backend.user.repository.UserRepository;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class PhotoService {

    private static final int PHOTOBOOTH_POINT_COST = 1200;
    private static final int RECENT_CONTEXT_MESSAGES = 5;

    private final PhotoRepository photoRepository;
    private final CharacterRepository characterRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final UserRepository userRepository;
    private final LlmClient llmClient;
    private final ImageClient imageClient;

    public PhotoService(PhotoRepository photoRepository, CharacterRepository characterRepository,
            ChatMessageRepository chatMessageRepository, UserRepository userRepository, LlmClient llmClient,
            ImageClient imageClient) {
        this.photoRepository = photoRepository;
        this.characterRepository = characterRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.userRepository = userRepository;
        this.llmClient = llmClient;
        this.imageClient = imageClient;
    }

    public List<PhotoConceptResponse> listConcepts() {
        return Arrays.stream(PhotoConcept.values()).map(PhotoConceptResponse::from).toList();
    }

    @Transactional
    public PhotoGenerationResponse generate(Long userId, Long characterId, GeneratePhotoRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));

        PhotoConcept concept = PhotoConcept.fromCodeOrLabel(request.concept()).orElse(PhotoConcept.CUSTOM);
        if (concept == PhotoConcept.CUSTOM && (request.customPrompt() == null || request.customPrompt().isBlank())) {
            throw new CustomException(ErrorCode.INVALID_REQUEST, "직접 만들기를 선택한 경우 설명을 입력해야 합니다.");
        }

        user.deductPoints(PHOTOBOOTH_POINT_COST);

        String refinedPrompt = refineImagePrompt(character, concept, request.customPrompt());
        List<String> imageUrls = imageClient.generateImages(refinedPrompt, character.getProfileImageUrl(), 1);
        if (imageUrls.isEmpty()) {
            throw new CustomException(ErrorCode.IMAGE_API_ERROR, "사진 생성 결과가 비어 있습니다.");
        }

        Photo photo = photoRepository.save(Photo.builder()
                .characterId(characterId)
                .type(PhotoType.PHOTOBOOTH)
                .concept(concept.getLabel())
                .promptText(refinedPrompt)
                .imageUrl(imageUrls.get(0))
                .build());

        return new PhotoGenerationResponse(PhotoResponse.from(photo), user.getPoints());
    }

    private String refineImagePrompt(Character character, PhotoConcept concept, String customPrompt) {
        String systemPrompt = """
                너는 캐릭터 사진 생성을 위한 이미지 프롬프트 작가야. 캐릭터의 외모와 상황 설명을 바탕으로
                이미지 생성 모델에 바로 사용할 수 있는 영어 프롬프트 한 문단을 작성해. JSON이나 다른 텍스트 없이
                프롬프트 문장만 응답해.
                """;

        StringBuilder context = new StringBuilder();
        context.append("캐릭터 외모: ").append(character.getAppearance()).append('\n');
        if (concept != PhotoConcept.CUSTOM) {
            context.append("컨셉: ").append(concept.getLabel()).append(" - ").append(concept.getPromptHint()).append('\n');
        }
        if (customPrompt != null && !customPrompt.isBlank()) {
            context.append("추가 요청: ").append(customPrompt).append('\n');
        }
        String recentMood = recentConversationMood(character.getId());
        if (!recentMood.isBlank()) {
            context.append("최근 대화 분위기: ").append(recentMood).append('\n');
        }

        return llmClient.generate(systemPrompt, List.of(LlmMessage.user(context.toString()))).trim();
    }

    private String recentConversationMood(Long characterId) {
        List<ChatMessage> history = chatMessageRepository
                .findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(characterId);
        int fromIndex = Math.max(0, history.size() - RECENT_CONTEXT_MESSAGES);
        return history.subList(fromIndex, history.size()).stream()
                .map(m -> (m.getSender() == MessageSender.USER ? "유저: " : "캐릭터: ") + m.getContent())
                .collect(Collectors.joining(" / "));
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
