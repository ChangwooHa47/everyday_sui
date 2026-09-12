package com.everyday.backend.photo.dto;

import com.everyday.backend.photo.entity.PhotoConcept;

public record PhotoConceptResponse(String code, String label) {

    public static PhotoConceptResponse from(PhotoConcept concept) {
        return new PhotoConceptResponse(concept.name(), concept.getLabel());
    }
}
