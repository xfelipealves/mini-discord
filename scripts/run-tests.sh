#!/bin/bash

echo "🧪 Mini Discord Test Runner"
echo "==========================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check Node.js version
print_step "Checking Node.js version"
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    print_error "Node.js 20+ required. Current version: $(node --version)"
    exit 1
fi
print_success "Node.js version: $(node --version)"

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/jest" ]; then
    print_step "Installing dependencies"
    npm install
    if [ $? -ne 0 ]; then
        print_error "Failed to install dependencies"
        exit 1
    fi
    print_success "Dependencies installed"
fi

# Check if API is running (for integration tests)
print_step "Checking if API is running"
if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    print_success "API is running - integration tests will be included"
    RUN_INTEGRATION=true
else
    print_error "API not running at http://localhost:3000"
    echo "To run integration tests:"
    echo "  Terminal 1: docker-compose up -d && npm run dev"
    echo "  Terminal 2: npm test"
    echo ""
    echo "Proceeding with unit tests only..."
    RUN_INTEGRATION=false
fi

# Run tests
print_step "Running tests"

if [ "$RUN_INTEGRATION" = true ]; then
    echo "Running all tests (unit + integration)..."
    npm test
else
    echo "Running unit tests only..."
    npm test -- tests/unit/
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    print_success "All tests passed! 🎉"
    
    if [ "$RUN_INTEGRATION" = false ]; then
        echo ""
        echo "💡 To run integration tests:"
        echo "   1. Start ScyllaDB: docker-compose up -d"
        echo "   2. Start API: npm run dev"
        echo "   3. Run tests: npm test"
    fi
else
    print_error "Some tests failed"
    echo ""
    echo "🔍 Troubleshooting:"
    echo "   • Make sure ScyllaDB is running: docker-compose up -d"
    echo "   • Make sure API is running: npm run dev"
    echo "   • Check logs for specific error details"
fi

exit $EXIT_CODE