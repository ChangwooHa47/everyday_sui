package com.everyday.backend.gallery.service;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.photo.dto.PhotoResponse;
import com.everyday.backend.photo.repository.PhotoRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class GalleryService {

    private final com.everyday.backend.character.service.MarketProductService marketProducts;


    private final PhotoRepository photoRepository;
    private final CharacterRepository characterRepository;

    public GalleryService(PhotoRepository photoRepository, CharacterRepository characterRepository, com.everyday.backend.character.service.MarketProductService marketProducts) {
        this.marketProducts = marketProducts;
        this.photoRepository = photoRepository;
        this.characterRepository = characterRepository;
    }

    public List<PhotoResponse> getGallery(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }

        marketProducts.requireAccess(characterId);
        return photoRepository.findAllByCharacterId(characterId).stream()
                .map(PhotoResponse::from)
                .toList();
    }
}
