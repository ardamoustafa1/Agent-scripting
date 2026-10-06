# Compile-only stubs (T-09)

Signatures only, written from how `src/psdk` uses the Genesys Platform SDK. They let CI compile the
licensed-SDK sources (`gradle compileJava -PvendorStubs=true`) so syntax, imports and internal
consistency of the production code path are checked. They contain NO vendor code or behavior and say
nothing about the real SDK signatures: that still needs the licensed jars (`-Ppsdk.repo`).
