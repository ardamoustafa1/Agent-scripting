# JTAPI compile-only stubs

These locally authored signatures match only the calls made by AesJtapiSource. They contain no vendor SDK binaries and do not establish compatibility with a licensed Avaya release. Run `gradle compileJava -PvendorStubs=true`; jar and bootJar are disabled in this mode. Licensed SDK compilation and lab acceptance remain required.
