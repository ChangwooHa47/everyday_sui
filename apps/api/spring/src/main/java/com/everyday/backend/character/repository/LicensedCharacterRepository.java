package com.everyday.backend.character.repository;

import com.everyday.backend.character.entity.LicensedCharacter;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LicensedCharacterRepository extends JpaRepository<LicensedCharacter, Long> {
    Optional<LicensedCharacter> findByLicenseId(String licenseId);
}
