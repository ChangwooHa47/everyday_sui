package com.everyday.backend.photo.dto;

import com.everyday.backend.photo.entity.Photo;

public record PhotoResponse(Long id, String imageUrl, String concept, String type, boolean selected) {

    public static PhotoResponse from(Photo photo) {
        return new PhotoResponse(
                photo.getId(), photo.getImageUrl(), photo.getConcept(), photo.getType().name(), photo.isSelected());
    }
}
