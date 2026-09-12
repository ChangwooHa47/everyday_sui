package com.everyday.backend.photo.repository;

import com.everyday.backend.photo.entity.Photo;
import com.everyday.backend.photo.entity.PhotoType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PhotoRepository extends JpaRepository<Photo, Long> {

    List<Photo> findAllByCharacterId(Long characterId);

    List<Photo> findAllByCharacterIdAndType(Long characterId, PhotoType type);

    Optional<Photo> findByIdAndCharacterId(Long id, Long characterId);
}
