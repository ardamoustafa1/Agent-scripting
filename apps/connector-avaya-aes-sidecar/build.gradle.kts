// Verbis Avaya sidecar (ADR-0020): Avaya Aura AES (JTAPI over TSAPI), POM / Proactive Contact
// outbound, and Avaya Aura Contact Center (CCMM web services + CCT WS-Notification) → NATS.
// Java 21 + Spring Boot.
//
// Avaya SDK jars are not on Maven Central (DevConnect downloads). Optional source sets compile
// only when the jars are supplied:
//   gradle build -Pavaya.jtapi=/opt/avaya/ecsjtapia.jar      (AES JTAPI source)
// Without it the sidecar builds with the replay source, POM (web services), Proactive Contact
// (Agent API socket protocol) and the AACC module (plain SOAP/HTTP) — which is what CI tests.
plugins {
    java
    id("org.springframework.boot") version "3.5.16"
    id("io.spring.dependency-management") version "1.1.7"
}

// Patched compatible maintenance lines; verified by the image vulnerability gate.
extra["jackson-bom.version"] = "2.21.7"
extra["tomcat.version"] = "10.1.60"
extra["micrometer.version"] = "1.15.12"
extra["spring-framework.version"] = "6.2.19"
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.bouncycastle" && requested.name.endsWith("lts8on")) {
            useVersion("2.73.13")
            because("Fix vulnerable Bouncy Castle LTS cryptography transitives")
        }
    }
}

group = "io.verbis"
version = "0.1.0"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

val jtapiJar = providers.gradleProperty("avaya.jtapi").orNull

repositories { mavenCentral() }

val vendorStubs = providers.gradleProperty("vendorStubs").map { it == "true" }.getOrElse(false)
check(!(vendorStubs && jtapiJar != null)) { "-PvendorStubs and -Pavaya.jtapi are mutually exclusive" }
val stubSources = sourceSets.create("vendorStubs") { java.srcDir("src/vendorStubs/java") }
val vendorStubsJar = tasks.register<Jar>("vendorStubsJar") {
    archiveBaseName.set("jtapi-stubs")
    destinationDirectory.set(layout.buildDirectory.dir("stubs"))
    from(stubSources.output)
}
if (jtapiJar != null || vendorStubs) sourceSets["main"].java.srcDir("src/jtapi/java")
if (vendorStubs) {
    tasks.named("bootJar") { enabled = false }
    tasks.named("jar") { enabled = false }
}

dependencies {
    implementation(platform("io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.20.0"))
    implementation("io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("io.nats:jnats:2.21.4")
    if (jtapiJar != null) implementation(files(jtapiJar))
    if (vendorStubs) compileOnly(files(vendorStubsJar))
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:junit-jupiter:1.21.3")
    testImplementation("org.testcontainers:testcontainers:1.21.3")
}

tasks.withType<Test> { useJUnitPlatform() }
