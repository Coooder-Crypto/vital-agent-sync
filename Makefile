SDK_PATH := $(shell xcrun --sdk iphoneos --show-sdk-path)

.PHONY: generate typecheck clean

generate:
	xcodegen generate

typecheck:
	mkdir -p build/module-cache
	swiftc -typecheck -module-cache-path build/module-cache -sdk "$(SDK_PATH)" -target arm64-apple-ios17.0 App/*.swift

clean:
	rm -rf build
