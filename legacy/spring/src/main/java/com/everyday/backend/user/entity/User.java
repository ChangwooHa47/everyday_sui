package com.everyday.backend.user.entity;

import com.everyday.backend.common.entity.BaseTimeEntity;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "users")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends BaseTimeEntity {

    public static final int DEFAULT_SIGNUP_POINTS = 1200;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String password;

    @Column(nullable = false)
    private int points;

    @Builder
    public User(String email, String password, int points) {
        this.email = email;
        this.password = password;
        this.points = points;
    }

    public void deductPoints(int amount) {
        if (this.points < amount) {
            throw new CustomException(ErrorCode.INSUFFICIENT_POINTS);
        }
        this.points -= amount;
    }

    public void updateEmail(String email) {
        this.email = email;
    }
}
