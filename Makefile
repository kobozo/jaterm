# JaTerm Development Makefile

# Default target - build everything and start dev server
.PHONY: dev
dev: build-helper build-tauri
	pnpm dev

# Build helper binary (native)
.PHONY: build-helper
build-helper:
	@echo "Building helper binary (native)..."
	cd src-helper && cargo build --release
	@echo "Helper binary built at src-helper/target/release/jaterm-agent"

# Build helper binary for Linux x86_64
.PHONY: build-helper-linux
build-helper-linux:
	@echo "Building helper binary for Linux x86_64..."
	cd src-helper && cargo build --release --target x86_64-unknown-linux-gnu
	@echo "Linux helper binary built at src-helper/target/x86_64-unknown-linux-gnu/release/jaterm-agent"

# Build helper for all platforms
.PHONY: build-helper-all
build-helper-all: build-helper build-helper-linux
	@echo "Built helpers for all platforms"

# Build Tauri app
.PHONY: build-tauri
build-tauri:
	@echo "Building Tauri app..."
	cd src-tauri && cargo build

# Build everything for production
.PHONY: build
build: build-helper
	pnpm tauri build

# Clean all build artifacts
.PHONY: clean
clean:
	cd src-helper && cargo clean
	cd src-tauri && cargo clean
	rm -rf dist

# Test helper binary locally
.PHONY: test-helper
test-helper: build-helper
	@echo "Testing helper binary..."
	@echo "Health check:"
	./src-helper/target/release/jaterm-agent health
	@echo ""
	@echo "Git status:"
	./src-helper/target/release/jaterm-agent git-status .
	@echo ""
	@echo "Git changes:"
	./src-helper/target/release/jaterm-agent git-changes .

# Compare helper outputs
.PHONY: compare-helper
compare-helper: build-helper
	@echo "Comparing bash vs binary helper outputs..."
	@echo "=== Bash helper health ==="
	~/.jaterm-helper/jaterm-agent health || echo "(bash helper not installed)"
	@echo ""
	@echo "=== Binary helper health ==="
	./src-helper/target/release/jaterm-agent health
	@echo ""
	@echo "=== Bash helper git-status ==="
	~/.jaterm-helper/jaterm-agent git-status . || echo "(bash helper not installed)"
	@echo ""
	@echo "=== Binary helper git-status ==="
	./src-helper/target/release/jaterm-agent git-status .
	@echo ""
	@echo "=== Bash helper git-changes ==="
	~/.jaterm-helper/jaterm-agent git-changes . || echo "(bash helper not installed)"
	@echo ""
	@echo "=== Binary helper git-changes ==="
	./src-helper/target/release/jaterm-agent git-changes .

# Run tests
.PHONY: test
test:
	cd src-helper && cargo test
	cd src-tauri && cargo test

# Install development version of helper locally for testing
.PHONY: install-helper-dev
install-helper-dev: build-helper
	@echo "Installing binary helper to ~/.jaterm-helper/ for testing..."
	mkdir -p ~/.jaterm-helper
	cp src-helper/target/release/jaterm-agent ~/.jaterm-helper/jaterm-agent-bin
	chmod +x ~/.jaterm-helper/jaterm-agent-bin
	@echo "Binary helper installed. Test with:"
	@echo "  ~/.jaterm-helper/jaterm-agent-bin health"
	@echo "  ~/.jaterm-helper/jaterm-agent-bin git-status ."

# Quick helper build (debug mode, faster)
.PHONY: helper-debug
helper-debug:
	@echo "Building helper binary (debug mode)..."
	cd src-helper && cargo build
	@echo "Helper binary built at src-helper/target/debug/jaterm-agent"

# Watch for changes and rebuild helper
.PHONY: watch-helper
watch-helper:
	@echo "Watching helper for changes..."
	cd src-helper && cargo watch -x build

.PHONY: help
help:
	@echo "JaTerm Development Makefile"
	@echo ""
	@echo "Available targets:"
	@echo "  make dev              - Build everything and start dev server (default)"
	@echo "  make build-helper     - Build the helper binary (release mode)"
	@echo "  make build-tauri      - Build the Tauri app"
	@echo "  make build            - Build everything for production"
	@echo "  make test-helper      - Test the helper binary"
	@echo "  make compare-helper   - Compare bash and binary helper outputs"
	@echo "  make install-helper-dev - Install binary helper for local testing"
	@echo "  make helper-debug     - Build helper in debug mode (faster)"
	@echo "  make test             - Run all tests"
	@echo "  make clean            - Clean all build artifacts"
	@echo "  make help             - Show this help message"