package com.everyday.backend.character.repository;

import com.everyday.backend.character.entity.Character;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CharacterRepository extends JpaRepository<Character, Long> {

    List<Character> findAllByUserId(Long userId);

    Optional<Character> findByIdAndUserId(Long id, Long userId);
}
