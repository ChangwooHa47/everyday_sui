package com.everyday.backend.character.service;

import com.everyday.backend.character.dto.CallNameRequest;
import com.everyday.backend.character.dto.CharacterResponse;
import com.everyday.backend.character.dto.CharacterSummaryResponse;
import com.everyday.backend.character.dto.CharacterUpdateRequest;
import com.everyday.backend.character.dto.CompileRequest;
import com.everyday.backend.character.dto.CompileResponse;
import com.everyday.backend.character.dto.InterviewAnswer;
import com.everyday.backend.character.dto.InterviewQuestionResponse;
import com.everyday.backend.character.dto.InterviewRequest;
import com.everyday.backend.character.dto.SelectPortraitRequest;
import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.entity.Gender;
import com.everyday.backend.character.entity.RelationshipType;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.image.ImageClient;
import com.everyday.backend.llm.LlmClient;
import com.everyday.backend.llm.LlmMessage;
import com.everyday.backend.llm.prompt.CharacterPersona;
import com.everyday.backend.llm.prompt.CharacterPromptBuilder;
import com.everyday.backend.photo.dto.PhotoResponse;
import com.everyday.backend.photo.entity.Photo;
import com.everyday.backend.photo.entity.PhotoType;
import com.everyday.backend.photo.repository.PhotoRepository;
import com.everyday.backend.user.entity.User;
import com.everyday.backend.user.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class CharacterService {

    private static final int CANDIDATE_PORTRAIT_COUNT = 4;

    private final CharacterRepository characterRepository;
    private final PhotoRepository photoRepository;
    private final UserRepository userRepository;
    private final LlmClient llmClient;
    private final ImageClient imageClient;
    private final ObjectMapper objectMapper;
    private final PortraitGenerationService portraitGenerationService;

    public CharacterService(CharacterRepository characterRepository, PhotoRepository photoRepository,
            UserRepository userRepository, LlmClient llmClient, ImageClient imageClient, ObjectMapper objectMapper,
            PortraitGenerationService portraitGenerationService) {
        this.characterRepository = characterRepository;
        this.photoRepository = photoRepository;
        this.userRepository = userRepository;
        this.llmClient = llmClient;
        this.imageClient = imageClient;
        this.portraitGenerationService = portraitGenerationService;
        this.objectMapper = objectMapper;
    }

    public InterviewQuestionResponse interview(InterviewRequest request) {
        String systemPrompt = """
                너는 AI 캐릭터 생성 인터뷰어야. 사용자가 원하는 캐릭터상을 구체화하기 위해 짧은 질문을 던진다.
                카테고리는 '외모', '분위기·스타일', '성격' 세 가지이며, 각 카테고리에서 최소 1개씩 답변을 받는 것이 목표다.
                이미 받은 답변으로 각 카테고리가 1개 이상 커버되었거나 총 답변 수가 6개 이상이면 done=true로 응답하고
                question/suggestedAnswers는 빈 값으로 둔다.
                반드시 아래 JSON 형식으로만 응답하고 그 외 어떤 텍스트도 포함하지 마라:
                {"category": "외모 또는 분위기·스타일 또는 성격", "question": "...", "suggestedAnswers": ["...","...","...","..."], "done": false}
                """;

        String contextText = buildInterviewContext(request);
        String raw = llmClient.generate(systemPrompt, List.of(LlmMessage.user(contextText)));

        try {
            return objectMapper.readValue(stripCodeFence(raw), InterviewQuestionResponse.class);
        } catch (Exception e) {
            return new InterviewQuestionResponse("성격", null, List.of(), true);
        }
    }

    @Transactional
    public CompileResponse compile(Long userId, CompileRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));

        RelationshipType relationshipType = RelationshipType.fromLabel(request.relationshipType());
        Gender gender = Gender.fromLabel(request.gender());

        CompiledPersonaJson compiled = generatePersona(request, relationshipType, gender);

        CharacterPersona persona = new CharacterPersona(
                request.name(), relationshipType.getLabel(), gender.getLabel(),
                compiled.summary(), compiled.appearance(), compiled.personality(), compiled.speechStyles(), null);
        String systemPrompt = CharacterPromptBuilder.buildSystemPrompt(persona);

        Character character = Character.builder()
                .user(user)
                .name(request.name())
                .birthday(request.birthday())
                .relationshipType(relationshipType)
                .gender(gender)
                .summary(compiled.summary())
                .appearance(compiled.appearance())
                .personality(compiled.personality())
                .speechStyles(compiled.speechStyles())
                .systemPrompt(systemPrompt)
                .imagePrompt(compiled.imagePrompt())
                .build();
        characterRepository.save(character);

        // 초상 후보(수 분 소요)는 백그라운드로 넘기고 즉시 응답한다.
        // 프론트는 갤러리 API를 폴링해 PROFILE 후보가 도착하는 대로 표시한다.
        portraitGenerationService.generateCandidates(
                character.getId(), compiled.imagePrompt(), CANDIDATE_PORTRAIT_COUNT);

        return new CompileResponse(CharacterResponse.from(character), List.of());
    }

    @Transactional
    public CharacterResponse selectPortrait(Long userId, Long characterId, SelectPortraitRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        Photo target = photoRepository.findByIdAndCharacterId(request.photoId(), characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.PHOTO_NOT_FOUND));

        photoRepository.findAllByCharacterIdAndType(characterId, PhotoType.PROFILE)
                .forEach(photo -> photo.markSelected(false));
        target.markSelected(true);
        character.updateProfileImage(target.getImageUrl());

        return CharacterResponse.from(character);
    }

    public List<CharacterSummaryResponse> list(Long userId) {
        return characterRepository.findAllByUserId(userId).stream()
                .map(CharacterSummaryResponse::from)
                .toList();
    }

    public CharacterResponse detail(Long userId, Long characterId) {
        return CharacterResponse.from(getOwnedCharacter(userId, characterId));
    }

    @Transactional
    public CharacterResponse update(Long userId, Long characterId, CharacterUpdateRequest request) {
        Character character = getOwnedCharacter(userId, characterId);

        String appearance = request.appearance() != null ? request.appearance() : character.getAppearance();
        String personality = request.personality() != null ? request.personality() : character.getPersonality();
        List<String> speechStyles = request.speechStyles() != null ? request.speechStyles() : character.getSpeechStyles();

        CharacterPersona persona = new CharacterPersona(
                character.getName(), character.getRelationshipType().getLabel(), character.getGender().getLabel(),
                character.getSummary(), appearance, personality, speechStyles, character.getCallName());
        String regeneratedSystemPrompt = CharacterPromptBuilder.buildSystemPrompt(persona);

        character.updateSettings(request.appearance(), request.personality(), request.speechStyles(),
                regeneratedSystemPrompt);
        return CharacterResponse.from(character);
    }

    @Transactional
    public CharacterResponse updateCallName(Long userId, Long characterId, CallNameRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        character.updateCallName(request.callName());
        return CharacterResponse.from(character);
    }

    @Transactional
    public CharacterResponse trainFace(Long userId, Long characterId) {
        Character character = getOwnedCharacter(userId, characterId);
        if (character.getProfileImageUrl() == null) {
            throw new CustomException(ErrorCode.INVALID_REQUEST, "대표 프로필 사진을 먼저 선택해야 합니다.");
        }
        String soulId = imageClient.trainSoul(character.getProfileImageUrl());
        character.updateSoulId(soulId);
        return CharacterResponse.from(character);
    }

    private Character getOwnedCharacter(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }
        return character;
    }

    private CompiledPersonaJson generatePersona(CompileRequest request, RelationshipType relationshipType,
            Gender gender) {
        String systemPrompt = """
                너는 사용자가 입력한 정보를 바탕으로 AI 연애/우정 시뮬레이션 캐릭터의 설정을 완성하는 작가야.
                반드시 아래 JSON 형식으로만 응답하고 그 외 텍스트는 포함하지 마라:
                {"summary": "한 줄 소개(20자 내외)", "appearance": "외모 묘사 2~3문장",
                 "personality": "성격 묘사 2~3문장", "speechStyles": ["말투 특징 3~5개"],
                 "imagePrompt": "얼굴 프로필 사진 생성을 위한 영어 이미지 생성 프롬프트"}
                """;

        String context = "이름: " + request.name()
                + "\n관계: " + relationshipType.getLabel()
                + "\n성별: " + gender.getLabel()
                + "\n자유 서술: " + (request.freeText() != null ? request.freeText() : "(없음)")
                + "\n인터뷰 답변:\n" + formatAnswers(request.interviewAnswers());

        String raw = llmClient.generate(systemPrompt, List.of(LlmMessage.user(context)));
        try {
            return objectMapper.readValue(stripCodeFence(raw), CompiledPersonaJson.class);
        } catch (Exception e) {
            throw new CustomException(ErrorCode.LLM_API_ERROR, "캐릭터 설정 생성 응답 파싱에 실패했습니다.");
        }
    }

    private String buildInterviewContext(InterviewRequest request) {
        return "관계: " + request.relationshipType()
                + "\n성별: " + request.gender()
                + "\n자유 서술: " + (request.freeText() != null ? request.freeText() : "(없음)")
                + "\n이전 답변:\n" + formatAnswers(request.previousAnswers());
    }

    private String formatAnswers(List<InterviewAnswer> answers) {
        if (answers == null || answers.isEmpty()) {
            return "(없음)";
        }
        return answers.stream()
                .map(a -> "- [" + a.category() + "] " + a.question() + " → " + a.answer())
                .collect(Collectors.joining("\n"));
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

    private record CompiledPersonaJson(
            String summary, String appearance, String personality, List<String> speechStyles, String imagePrompt) {
    }
}
