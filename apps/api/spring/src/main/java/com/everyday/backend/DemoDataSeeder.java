package com.everyday.backend;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.entity.Gender;
import com.everyday.backend.character.entity.RelationshipType;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.llm.prompt.CharacterPersona;
import com.everyday.backend.llm.prompt.CharacterPromptBuilder;
import com.everyday.backend.photo.entity.Photo;
import com.everyday.backend.photo.entity.PhotoType;
import com.everyday.backend.photo.repository.PhotoRepository;
import com.everyday.backend.user.entity.User;
import com.everyday.backend.user.repository.UserRepository;
import java.time.LocalDate;
import java.util.List;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 데모 진행자가 회원가입/캐릭터 생성 플로우를 처음부터 타지 않아도 바로 채팅/에피소드/포토부스를
 * 시연할 수 있도록 데모 계정과 샘플 캐릭터를 미리 채워 넣는다. 외부 LLM/이미지 API는 호출하지 않는다.
 */
@Component
@org.springframework.context.annotation.Profile("baseline")
public class DemoDataSeeder implements CommandLineRunner {

    private static final String DEMO_EMAIL = "demo@everyday.app";
    private static final String DEMO_PASSWORD = "demo1234!";
    private static final String DEMO_PROFILE_IMAGE_URL = "https://placehold.co/400x400?text=%EC%84%9C%EC%A4%80";

    private final UserRepository userRepository;
    private final CharacterRepository characterRepository;
    private final PhotoRepository photoRepository;
    private final PasswordEncoder passwordEncoder;

    public DemoDataSeeder(UserRepository userRepository, CharacterRepository characterRepository,
            PhotoRepository photoRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.characterRepository = characterRepository;
        this.photoRepository = photoRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        User demoUser = userRepository.findByEmail(DEMO_EMAIL)
                .orElseGet(() -> userRepository.save(User.builder()
                        .email(DEMO_EMAIL)
                        .password(passwordEncoder.encode(DEMO_PASSWORD))
                        .points(User.DEFAULT_SIGNUP_POINTS)
                        .build()));

        if (!characterRepository.findAllByUserId(demoUser.getId()).isEmpty()) {
            return;
        }

        String summary = "겉은 무심한데, 나에게만 온도가 2도 높은 사람";
        String appearance = "웃을 때 눈이 접히는 강아지상. 검은 반곱슬 머리에 키 183, 어깨가 넓고 손이 큰 편.";
        String personality = "평소엔 심드렁한데 나한테만 다정함. 장난기가 많고, 힘든 티는 절대 안 내는 타입.";
        List<String> speechStyles = List.of("~던데?", "왜 이러냐ㅋㅋ", "귀찮은데", "그니까", "아니 근데");

        CharacterPersona persona = new CharacterPersona(
                "서준", RelationshipType.LOVER.getLabel(), Gender.MALE.getLabel(),
                summary, appearance, personality, speechStyles, null);
        String systemPrompt = CharacterPromptBuilder.buildSystemPrompt(persona);
        String imagePrompt = "korean man, 24 years old, puppy-like warm face, dark slightly wavy hair, "
                + "tall and broad-shouldered, casual daily photo, soft lighting";

        Character character = characterRepository.save(Character.builder()
                .user(demoUser)
                .name("서준")
                .birthday(LocalDate.of(2001, 3, 15))
                .relationshipType(RelationshipType.LOVER)
                .gender(Gender.MALE)
                .summary(summary)
                .appearance(appearance)
                .personality(personality)
                .speechStyles(speechStyles)
                .systemPrompt(systemPrompt)
                .imagePrompt(imagePrompt)
                .build());
        character.updateProfileImage(DEMO_PROFILE_IMAGE_URL);
        characterRepository.save(character);

        Photo profilePhoto = photoRepository.save(Photo.builder()
                .characterId(character.getId())
                .type(PhotoType.PROFILE)
                .promptText(imagePrompt)
                .imageUrl(DEMO_PROFILE_IMAGE_URL)
                .build());
        profilePhoto.markSelected(true);
        photoRepository.save(profilePhoto);
    }
}
