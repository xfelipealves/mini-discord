#!/bin/bash

# Script para testar conceitos específicos do ScyllaDB
# Usage: ./scripts/test-scylla-concepts.sh [concept]
# Concepts: all, lwt, consistency, pagination, partitioning, performance

set -e

echo "🚀 ScyllaDB Concepts Testing Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}📋 Step: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if ScyllaDB is running
check_scylla() {
    print_step "Checking ScyllaDB connection"
    
    if ! docker ps | grep -q scylla; then
        print_error "ScyllaDB container not found. Please start it first:"
        echo "  docker-compose up -d"
        exit 1
    fi
    
    # Wait for ScyllaDB to be ready
    echo "Waiting for ScyllaDB to be ready..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if docker exec -it $(docker ps | grep scylla | awk '{print $1}' | head -1) cqlsh -e "DESCRIBE KEYSPACES" >/dev/null 2>&1; then
            print_success "ScyllaDB is ready"
            break
        fi
        echo "Waiting... ($timeout seconds remaining)"
        sleep 2
        timeout=$((timeout-2))
    done
    
    if [ $timeout -le 0 ]; then
        print_error "ScyllaDB failed to become ready within 60 seconds"
        exit 1
    fi
}

# Test LWT (Lightweight Transactions)
test_lwt() {
    print_step "Testing LWT (Lightweight Transactions) - Idempotency"
    
    echo "📝 Sending first message with client_msg_id..."
    RESPONSE1=$(curl -s -X POST http://localhost:3000/api/messages \
        -H "Content-Type: application/json" \
        -d '{
            "channel_id": "lwt-test",
            "user_id": "test-user",
            "content": "LWT Test Message",
            "client_msg_id": "lwt-unique-test-123"
        }')
    
    if echo "$RESPONSE1" | grep -q '"message_id"'; then
        print_success "First message sent successfully"
    else
        print_error "Failed to send first message: $RESPONSE1"
        return 1
    fi
    
    echo "📝 Sending same message again (should be deduped)..."
    RESPONSE2=$(curl -s -X POST http://localhost:3000/api/messages \
        -H "Content-Type: application/json" \
        -d '{
            "channel_id": "lwt-test",
            "user_id": "test-user",
            "content": "LWT Test Message",
            "client_msg_id": "lwt-unique-test-123"
        }')
    
    if echo "$RESPONSE2" | grep -q '"deduped":true'; then
        print_success "Message correctly deduped via LWT!"
    else
        print_error "LWT deduplication failed: $RESPONSE2"
        return 1
    fi
    
    echo "📝 Verifying only one message exists in database..."
    MESSAGES=$(curl -s "http://localhost:3000/api/channels/lwt-test/messages")
    COUNT=$(echo "$MESSAGES" | grep -o '"message_id"' | wc -l)
    
    if [ "$COUNT" -eq 1 ]; then
        print_success "LWT Test PASSED: Only 1 message in database (deduplication worked)"
    else
        print_error "LWT Test FAILED: Found $COUNT messages instead of 1"
        return 1
    fi
}

# Test Consistency Levels
test_consistency() {
    print_step "Testing Consistency Levels"
    
    LEVELS=("ONE" "QUORUM" "ALL")
    
    for LEVEL in "${LEVELS[@]}"; do
        echo "📝 Testing write consistency: $LEVEL"
        RESPONSE=$(curl -s -X POST http://localhost:3000/api/messages \
            -H "Content-Type: application/json" \
            -d "{
                \"channel_id\": \"consistency-test\",
                \"user_id\": \"test-user\",
                \"content\": \"Test with $LEVEL consistency\",
                \"consistency\": \"$LEVEL\"
            }")
        
        if echo "$RESPONSE" | grep -q '"message_id"'; then
            print_success "Write with $LEVEL consistency succeeded"
        else
            print_error "Write with $LEVEL consistency failed: $RESPONSE"
            return 1
        fi
        
        echo "📝 Testing read consistency: $LEVEL"
        READ_RESPONSE=$(curl -s "http://localhost:3000/api/channels/consistency-test/messages?consistency=$LEVEL&limit=1")
        
        if echo "$READ_RESPONSE" | grep -q '"items"'; then
            print_success "Read with $LEVEL consistency succeeded"
        else
            print_error "Read with $LEVEL consistency failed: $READ_RESPONSE"
            return 1
        fi
    done
    
    echo "📝 Testing invalid consistency level..."
    INVALID_RESPONSE=$(curl -s -X POST http://localhost:3000/api/messages \
        -H "Content-Type: application/json" \
        -d '{
            "channel_id": "consistency-test",
            "user_id": "test-user",
            "content": "Test with invalid consistency",
            "consistency": "INVALID_LEVEL"
        }')
    
    if echo "$INVALID_RESPONSE" | grep -q '"warning"'; then
        print_success "Invalid consistency level properly handled with warning"
    else
        print_warning "Invalid consistency warning not found (may still work with defaults)"
    fi
}

# Test Pagination
test_pagination() {
    print_step "Testing TimeUUID-based Pagination"
    
    echo "📝 Inserting multiple messages for pagination test..."
    for i in {1..10}; do
        curl -s -X POST http://localhost:3000/api/messages \
            -H "Content-Type: application/json" \
            -d "{
                \"channel_id\": \"pagination-test\",
                \"user_id\": \"user-$i\",
                \"content\": \"Message $i for pagination\"
            }" > /dev/null
        sleep 0.1  # Small delay to ensure different TimeUUIDs
    done
    
    print_success "Inserted 10 messages"
    
    echo "📝 Testing first page..."
    PAGE1=$(curl -s "http://localhost:3000/api/channels/pagination-test/messages?limit=3")
    PAGE1_COUNT=$(echo "$PAGE1" | grep -o '"message_id"' | wc -l)
    NEXT_CURSOR=$(echo "$PAGE1" | grep -o '"next_before":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$PAGE1_COUNT" -eq 3 ] && [ -n "$NEXT_CURSOR" ]; then
        print_success "First page: got 3 messages with next_before cursor"
    else
        print_error "First page failed: got $PAGE1_COUNT messages, cursor: '$NEXT_CURSOR'"
        return 1
    fi
    
    echo "📝 Testing second page with cursor..."
    PAGE2=$(curl -s "http://localhost:3000/api/channels/pagination-test/messages?limit=3&before=$NEXT_CURSOR")
    PAGE2_COUNT=$(echo "$PAGE2" | grep -o '"message_id"' | wc -l)
    
    if [ "$PAGE2_COUNT" -eq 3 ]; then
        print_success "Second page: got 3 more messages"
    else
        print_error "Second page failed: got $PAGE2_COUNT messages instead of 3"
        return 1
    fi
    
    echo "📝 Verifying no overlap between pages..."
    PAGE1_IDS=$(echo "$PAGE1" | grep -o '"message_id":"[^"]*"' | sort)
    PAGE2_IDS=$(echo "$PAGE2" | grep -o '"message_id":"[^"]*"' | sort)
    
    OVERLAP=$(comm -12 <(echo "$PAGE1_IDS") <(echo "$PAGE2_IDS") | wc -l)
    
    if [ "$OVERLAP" -eq 0 ]; then
        print_success "Pagination Test PASSED: No overlap between pages"
    else
        print_error "Pagination Test FAILED: Found $OVERLAP overlapping messages"
        return 1
    fi
}

# Test Channel Partitioning
test_partitioning() {
    print_step "Testing Channel Partitioning"
    
    CHANNELS=("channel-a" "channel-b" "channel-c")
    
    echo "📝 Inserting messages in different channels..."
    for CHANNEL in "${CHANNELS[@]}"; do
        for i in {1..3}; do
            curl -s -X POST http://localhost:3000/api/messages \
                -H "Content-Type: application/json" \
                -d "{
                    \"channel_id\": \"$CHANNEL\",
                    \"user_id\": \"test-user\",
                    \"content\": \"$CHANNEL message $i\"
                }" > /dev/null
        done
    done
    
    print_success "Inserted 3 messages per channel in 3 channels"
    
    echo "📝 Verifying channel isolation..."
    for CHANNEL in "${CHANNELS[@]}"; do
        RESPONSE=$(curl -s "http://localhost:3000/api/channels/$CHANNEL/messages")
        COUNT=$(echo "$RESPONSE" | grep -o '"message_id"' | wc -l)
        CONTENT_CHECK=$(echo "$RESPONSE" | grep -c "$CHANNEL message" || true)
        
        if [ "$COUNT" -eq 3 ] && [ "$CONTENT_CHECK" -eq 3 ]; then
            print_success "$CHANNEL: Correctly isolated with 3 messages"
        else
            print_error "$CHANNEL: Isolation failed - count: $COUNT, content matches: $CONTENT_CHECK"
            return 1
        fi
    done
    
    print_success "Partitioning Test PASSED: All channels properly isolated"
}

# Performance test
test_performance() {
    print_step "Testing Basic Performance"
    
    echo "📝 Testing rapid message insertion..."
    START_TIME=$(date +%s%N)
    
    for i in {1..50}; do
        curl -s -X POST http://localhost:3000/api/messages \
            -H "Content-Type: application/json" \
            -d "{
                \"channel_id\": \"perf-test\",
                \"user_id\": \"perf-user-$((i % 10))\",
                \"content\": \"Performance test message $i\",
                \"client_msg_id\": \"perf-$i\"
            }" > /dev/null &
        
        # Limit concurrent requests
        if [ $((i % 10)) -eq 0 ]; then
            wait
        fi
    done
    wait
    
    END_TIME=$(date +%s%N)
    DURATION=$(((END_TIME - START_TIME) / 1000000))  # Convert to milliseconds
    
    echo "📝 Verifying all messages were inserted..."
    RESPONSE=$(curl -s "http://localhost:3000/api/channels/perf-test/messages?limit=100")
    COUNT=$(echo "$RESPONSE" | grep -o '"message_id"' | wc -l)
    
    if [ "$COUNT" -eq 50 ]; then
        print_success "Performance Test PASSED: 50 messages inserted in ${DURATION}ms (avg: $((DURATION/50))ms per message)"
    else
        print_error "Performance Test FAILED: Expected 50 messages, got $COUNT"
        return 1
    fi
}

# Run all tests
run_all_tests() {
    print_step "Running All ScyllaDB Concept Tests"
    
    TESTS=("lwt" "consistency" "pagination" "partitioning" "performance")
    PASSED=0
    FAILED=0
    
    for TEST in "${TESTS[@]}"; do
        echo ""
        echo "🧪 Testing: $TEST"
        echo "------------------------"
        
        if test_$TEST; then
            print_success "$TEST test completed successfully"
            PASSED=$((PASSED + 1))
        else
            print_error "$TEST test failed"
            FAILED=$((FAILED + 1))
        fi
    done
    
    echo ""
    echo "📊 Test Summary"
    echo "=========================="
    print_success "Passed: $PASSED"
    if [ $FAILED -gt 0 ]; then
        print_error "Failed: $FAILED"
        exit 1
    else
        print_success "All tests passed! 🎉"
    fi
}

# Main execution
main() {
    # Check if API is running
    if ! curl -s http://localhost:3000/health >/dev/null 2>&1; then
        print_error "API server not responding at http://localhost:3000"
        echo "Please start the API server:"
        echo "  npm run dev"
        exit 1
    fi
    
    # Check ScyllaDB
    check_scylla
    
    # Parse command line argument
    TEST_TYPE="${1:-all}"
    
    case $TEST_TYPE in
        "lwt")
            test_lwt
            ;;
        "consistency")
            test_consistency
            ;;
        "pagination")
            test_pagination
            ;;
        "partitioning")
            test_partitioning
            ;;
        "performance")
            test_performance
            ;;
        "all")
            run_all_tests
            ;;
        *)
            echo "Usage: $0 [lwt|consistency|pagination|partitioning|performance|all]"
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"