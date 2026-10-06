// Verbis Genesys Engage sidecar (ADR-0019): Platform SDK (T-Server, Interaction Server, Config
// Server, OCS desktop protocol) → NATS JetStream. Java 21 + Spring Boot.
//
// The Genesys Platform SDK jars are licensed and not on Maven Central. The PSDK adapter in
// `src/psdk/java` is compiled only when a repository is given:
//   gradle build -Ppsdk.repo=https://repo.example/genesys -Ppsdk.version=9.0.010.xx
// Without it the sidecar builds with the replay source (dev, CI, tests).
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

val psdkRepo = providers.gradleProperty("psdk.repo").orNull
val psdkVersion = providers.gradleProperty("psdk.version").getOrElse("9.0.010.04")

repositories {
    mavenCentral()
    if (psdkRepo != null) maven { url = uri(psdkRepo); credentials(PasswordCredentials::class) { name = "psdk" } }
}

if (psdkRepo != null) {
    sourceSets["main"].java.srcDir("src/psdk/java")
}

dependencies {
    implementation(platform("io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.20.0"))
    implementation("io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
    implementation("io.nats:jnats:2.21.4")
    if (psdkRepo != null) {
        implementation("com.genesyslab.platform:commons:$psdkVersion")
        implementation("com.genesyslab.platform:voiceprotocol:$psdkVersion")
        implementation("com.genesyslab.platform:openmediaprotocol:$psdkVersion")
        implementation("com.genesyslab.platform:configurationprotocol:$psdkVersion")
        implementation("com.genesyslab.platform:applicationblocks-com:$psdkVersion")
    }
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:junit-jupiter:1.21.3")
    testImplementation("org.testcontainers:testcontainers:1.21.3")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
