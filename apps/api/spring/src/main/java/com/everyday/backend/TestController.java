package com.everyday.backend;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@org.springframework.context.annotation.Profile("baseline")
public class TestController {

    @GetMapping("/")
    public String hello() {
        return "Hello Docker!";
    }
}