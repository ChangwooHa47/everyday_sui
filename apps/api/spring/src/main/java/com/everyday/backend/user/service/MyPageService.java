package com.everyday.backend.user.service;

import com.everyday.backend.character.dto.CharacterSummaryResponse;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.user.dto.MyPageResponse;
import com.everyday.backend.user.dto.MyPageUpdateRequest;
import com.everyday.backend.user.entity.User;
import com.everyday.backend.user.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class MyPageService {

    private final UserRepository userRepository;
    private final CharacterRepository characterRepository;

    public MyPageService(UserRepository userRepository, CharacterRepository characterRepository) {
        this.userRepository = userRepository;
        this.characterRepository = characterRepository;
    }

    public MyPageResponse getMe(Long userId) {
        User user = getUser(userId);
        var characters = characterRepository.findAllByUserId(userId).stream()
                .map(CharacterSummaryResponse::from)
                .toList();
        return MyPageResponse.of(user, characters);
    }

    @Transactional
    public MyPageResponse updateMe(Long userId, MyPageUpdateRequest request) {
        User user = getUser(userId);

        if (request.email() != null && !request.email().isBlank() && !request.email().equals(user.getEmail())) {
            if (userRepository.existsByEmail(request.email())) {
                throw new CustomException(ErrorCode.DUPLICATE_EMAIL);
            }
            user.updateEmail(request.email());
        }

        var characters = characterRepository.findAllByUserId(userId).stream()
                .map(CharacterSummaryResponse::from)
                .toList();
        return MyPageResponse.of(user, characters);
    }

    private User getUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new CustomException(ErrorCode.USER_NOT_FOUND));
    }
}
