param([ValidateSet('test', 'serve', 'package')][string]$Action = 'test')
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$originalJavaHome = $env:JAVA_HOME
try {
    if (-not $env:JAVA_HOME -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
        $toolRoot = Join-Path (Split-Path (Split-Path $repository -Parent) -Parent) '.local-tools'
        $jdk = Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
            Select-Object -First 1
        if (-not $jdk) { throw 'Java 21 is required. Set JAVA_HOME to your JDK 21 directory.' }
        $env:JAVA_HOME = $jdk.FullName
    }
    Push-Location $repository
    try {
        $task = switch ($Action) { 'test' { 'test' }; 'serve' { 'bootTestRun' }; 'package' { 'bootJar' } }
        # Java's Windows argument-file reader uses the native encoding for non-ASCII paths.
        & .\gradlew.bat $task --console=plain '-Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT'
        if ($LASTEXITCODE -ne 0) { throw "Gradle $task failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
} finally { $env:JAVA_HOME = $originalJavaHome }
