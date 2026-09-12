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

    private final com.everyday.backend.character.service.MarketProductService marketProducts;


    private static final int CANDIDATE_PORTRAIT_COUNT = 4;

    private final CharacterRepository characterRepository;
    private final PhotoRepository photoRepository;
    private final UserRepository userRepository;
    private final LlmClient llmClient;
    private final ImageClient imageClient;
    private final ObjectMapper objectMapper;
    private final org.springframework.context.ApplicationEventPublisher events;
    private final PortraitJobQueue portraitJobs;
    private final CompileRequests compileRequests;
    private final SoulTrainingRequests soulRequests;
    private final org.springframework.transaction.support.TransactionTemplate transaction;

    public CharacterService(CharacterRepository characterRepository, PhotoRepository photoRepository,
            UserRepository userRepository, LlmClient llmClient, ImageClient imageClient, ObjectMapper objectMapper,
            org.springframework.context.ApplicationEventPublisher events,
            org.springframework.beans.factory.ObjectProvider<PortraitJobQueue> portraitJobs, com.everyday.backend.character.service.MarketProductService marketProducts,
            org.springframework.beans.factory.ObjectProvider<CompileRequests> compileRequests,
            org.springframework.beans.factory.ObjectProvider<SoulTrainingRequests> soulRequests,
            org.springframework.transaction.PlatformTransactionManager manager) {
        this.marketProducts = marketProducts;
        this.characterRepository = characterRepository;
        this.photoRepository = photoRepository;
        this.userRepository = userRepository;
        this.llmClient = llmClient;
        this.imageClient = imageClient;
        this.events = events;
        this.portraitJobs = portraitJobs.getIfAvailable();
        this.objectMapper = objectMapper;
        this.compileRequests = compileRequests.getIfAvailable();
        this.soulRequests = soulRequests.getIfAvailable();
        this.transaction = new org.springframework.transaction.support.TransactionTemplate(manager);
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
            throw new CustomException(ErrorCode.LLM_API_ERROR);
        }
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public CompileResponse compile(Long userId, CompileRequest request) {
        RelationshipType relationshipType = RelationshipType.fromLabel(request.relationshipType());
        Gender gender = Gender.fromLabel(request.gender());
        if (!userRepository.existsById(userId)) throw new CustomException(ErrorCode.USER_NOT_FOUND);
        Long existing = compileRequests == null ? null : compileRequests.claim(userId, request);
        if (existing != null) return transaction.execute(tx -> new CompileResponse(CharacterResponse.from(getOwnedCharacter(userId, existing)), List.of()));
        var providerStarted = new java.util.concurrent.atomic.AtomicBoolean();
        try {
        return transaction.execute(tx -> {
        User user = userRepository.findById(userId).orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));
        llmClient.requireConfigured();
        providerStarted.set(true);
        CompiledPersonaJson compiled = generatePersona(request, relationshipType, gender);
        var examples = compiled.examples() == null ? List.<com.everyday.backend.character.entity.AuthoredExample>of() : compiled.examples().stream()
                .map(e -> new com.everyday.backend.character.entity.AuthoredExample(e.role(), e.content())).toList();

        CharacterPersona persona = new CharacterPersona(
                request.name(), relationshipType.getLabel(), gender.getLabel(),
                compiled.summary(), compiled.appearance(), compiled.personality(), compiled.speechStyles(), null);
        String systemPrompt = CharacterPromptBuilder.buildSystemPrompt(persona) + examplePrompt(examples);

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
        character.setAuthoredExamples(examples);
        characterRepository.save(character);

        // 초상 후보(수 분 소요)는 백그라운드로 넘기고 즉시 응답한다.
        // 프론트는 갤러리 API를 폴링해 PROFILE 후보가 도착하는 대로 표시한다.
        if (portraitJobs != null) portraitJobs.enqueue(character.getId(), compiled.imagePrompt(), CANDIDATE_PORTRAIT_COUNT, request.deferPortraitGeneration());
        else events.publishEvent(new PortraitGenerationService.Request(character.getId(), compiled.imagePrompt(), CANDIDATE_PORTRAIT_COUNT));
        if (compileRequests != null) compileRequests.complete(request.requestId(), character.getId());
        return new CompileResponse(CharacterResponse.from(character), List.of());
        });
        } catch (RuntimeException error) {
            if (!providerStarted.get() && compileRequests != null) compileRequests.releaseBeforeProvider(request.requestId());
            throw error;
        }
    }

    @Transactional
    public CharacterResponse selectPortrait(Long userId, Long characterId, SelectPortraitRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        marketProducts.requireEditable(characterId);
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
        return CharacterResponse.from(getOwnedCharacter(userId, characterId), marketProducts.isLicensed(characterId));
    }

    public java.util.Map<String, String> portraitStatus(Long userId, Long characterId) {
        getOwnedCharacter(userId, characterId);
        return java.util.Map.of("status", portraitJobs == null ? "pending" : portraitJobs.status(characterId));
    }

    public com.everyday.backend.character.dto.ProductDraftResponse productDraft(Long userId, Long characterId) {
        Character character = getOwnedCharacter(userId, characterId);
        marketProducts.requireEditable(characterId);
        return com.everyday.backend.character.dto.ProductDraftResponse.from(character);
    }

    @Transactional
    public java.util.Map<String, String> startPortraits(Long userId, Long characterId, String style) {
        Character character = getOwnedCharacter(userId, characterId);
        marketProducts.requireEditable(characterId);
        if (portraitJobs != null) portraitJobs.start(characterId, character.getImagePrompt()
                + (style == null || style.isBlank() ? "" : "\nRequested expression, atmosphere and scene: " + style));
        return portraitStatus(userId, characterId);
    }

    @Transactional
    public CharacterResponse update(Long userId, Long characterId, CharacterUpdateRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        marketProducts.requireEditable(characterId);

        String appearance = request.appearance() != null ? request.appearance() : character.getAppearance();
        String personality = request.personality() != null ? request.personality() : character.getPersonality();
        List<String> speechStyles = request.speechStyles() != null ? request.speechStyles() : character.getSpeechStyles();

        CharacterPersona persona = new CharacterPersona(
                character.getName(), character.getRelationshipType().getLabel(), character.getGender().getLabel(),
                character.getSummary(), appearance, personality, speechStyles, character.getCallName());
        String regeneratedSystemPrompt = CharacterPromptBuilder.buildSystemPrompt(persona) + examplePrompt(character.getAuthoredExamples());

        character.updateSettings(request.appearance(), request.personality(), request.speechStyles(),
                regeneratedSystemPrompt);
        return CharacterResponse.from(character);
    }

    @Transactional
    public CharacterResponse updateCallName(Long userId, Long characterId, CallNameRequest request) {
        Character character = getOwnedCharacter(userId, characterId);
        character.updateCallName(request.callName());
        CharacterPersona persona = new CharacterPersona(character.getName(), character.getRelationshipType().getLabel(),
                character.getGender().getLabel(), character.getSummary(), character.getAppearance(),
                character.getPersonality(), character.getSpeechStyles(), character.getCallName());
        character.updateSettings(null, null, null, marketProducts.personalizedPrompt(characterId, CharacterPromptBuilder.buildSystemPrompt(persona) + examplePrompt(character.getAuthoredExamples()), character.getCallName()));
        return CharacterResponse.from(character, marketProducts.isLicensed(characterId));
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public CharacterResponse trainFace(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        marketProducts.requireAccess(characterId);
        marketProducts.requireEditable(characterId);
        if (character.getProfileImageUrl() == null) {
            throw new CustomException(ErrorCode.INVALID_REQUEST, "대표 프로필 사진을 먼저 선택해야 합니다.");
        }
        imageClient.requireConfigured();
        if (character.getSoulId() == null) {
            String existing = soulRequests == null ? null : soulRequests.claim(characterId, character.getProfileImageUrl());
            if (existing == null) {
                // Claim is durable before the paid POST; no DB connection is held during registration.
                String soulId = imageClient.trainSoul(character.getProfileImageUrl());
                return transaction.execute(tx -> {
                    Character saved = characterRepository.findForUpdateById(characterId).orElseThrow();
                    saved.updateSoulId(soulId);
                    if (soulRequests != null) soulRequests.complete(characterId);
                    return CharacterResponse.from(saved);
                });
            }
        }
        return transaction.execute(tx -> {
            Character saved = characterRepository.findForUpdateById(characterId).orElseThrow();
            if (!saved.isSoulReady()) saved.markSoulReady(imageClient.soulReady(saved.getSoulId()));
            return CharacterResponse.from(saved);
        });
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

    private CompiledPersonaJson generatePersona(CompileRequest request, RelationshipType relationshipType,
            Gender gender) {
        String systemPrompt = """
                너는 사용자가 입력한 정보를 바탕으로 AI 연애/우정 시뮬레이션 캐릭터의 설정을 완성하는 작가야.
                반드시 아래 JSON 형식으로만 응답하고 그 외 텍스트는 포함하지 마라:
                {"summary": "한 줄 소개(20자 내외)", "appearance": "외모 묘사 2~3문장",
                 "personality": "성격 묘사 2~3문장", "speechStyles": ["말투 특징 3~5개"],
                 "imagePrompt": "얼굴 프로필 사진 생성을 위한 영어 이미지 생성 프롬프트",
                 "examples": [{"role":"user","content":"가상의 질문"},{"role":"assistant","content":"캐릭터다운 답변"}]}
                examples에는 일상과 진지한 상황의 가상 대화 두 쌍을 작성해. 실제 사용자의 사적 경험이나 이름은 넣지 마.
                """;

        String context = "이름: " + request.name()
                + "\n관계: " + relationshipType.getLabel()
                + "\n성별: " + gender.getLabel()
                + "\n자유 서술: " + (request.freeText() != null ? request.freeText() : "(없음)")
                + "\n인터뷰 답변:\n" + formatAnswers(request.interviewAnswers());

        String raw = llmClient.generate(systemPrompt, List.of(LlmMessage.user(context)));
        try {
            var result = objectMapper.readValue(stripCodeFence(raw), CompiledPersonaJson.class);
            if (result.examples() != null && result.examples().size() > 12) throw new IllegalArgumentException("Too many examples");
            if (result.examples() != null) result.examples().forEach(e -> new com.everyday.backend.character.entity.AuthoredExample(e.role(), e.content()));
            if (result.summary() == null || result.summary().length() > 500 || result.appearance() == null || result.appearance().length() > 4000
                    || result.personality() == null || result.personality().length() > 4000 || result.imagePrompt() == null || result.imagePrompt().isBlank()
                    || result.imagePrompt().length() > 8000 || result.speechStyles() == null || result.speechStyles().size() > 20
                    || result.speechStyles().stream().anyMatch(s -> s == null || s.length() > 255)) throw new IllegalArgumentException("Invalid generated settings");
            return result;
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

    private String examplePrompt(List<com.everyday.backend.character.entity.AuthoredExample> examples) {
        if (examples.isEmpty()) return "";
        return "\n[작가가 구성한 가상 예시: 실제 사용자와의 기억이 아닙니다. 현재 설정과 충돌하면 현재 설정이 우선입니다.]\n"
                + examples.stream().map(e -> e.getRole() + ": " + e.getContent()).collect(Collectors.joining("\n"));
    }

    private record ExampleJson(String role, String content) {}
    private record CompiledPersonaJson(
            String summary, String appearance, String personality, List<String> speechStyles, String imagePrompt, List<ExampleJson> examples) {
    }
}
