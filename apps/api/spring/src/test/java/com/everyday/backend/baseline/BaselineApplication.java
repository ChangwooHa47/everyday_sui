package com.everyday.backend.baseline;

import com.everyday.backend.BackendApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;

/** Local fixture server, only on the test classpath; never packaged in bootJar. */
public class BaselineApplication {
    public static void main(String[] args) {
        new SpringApplicationBuilder(BackendApplication.class, BaselineAiConfiguration.class)
                .profiles("baseline").run(args);
    }
}
