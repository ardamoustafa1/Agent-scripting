# Build: docker build --build-arg PSDK_REPO=… -t verbis/engage-sidecar .
FROM gradle:8.14-jdk21 AS build
ARG PSDK_REPO=""
ARG PSDK_VERSION="9.0.010.04"
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts ./
COPY src ./src
RUN if [ -n "$PSDK_REPO" ]; then gradle --no-daemon bootJar -Ppsdk.repo="$PSDK_REPO" -Ppsdk.version="$PSDK_VERSION"; else gradle --no-daemon bootJar; fi

FROM eclipse-temurin:21-jre-alpine
RUN apk upgrade --no-cache
RUN addgroup -S -g 10001 verbis && adduser -S -u 10001 verbis -G verbis
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD-SHELL wget -q -O- http://127.0.0.1:8085/actuator/health >/dev/null || exit 1
WORKDIR /app
COPY --from=build --chown=10001:10001 /src/build/libs/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
