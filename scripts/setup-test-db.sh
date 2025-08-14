#!/bin/bash

# Setup test database schema
echo "🔧 Setting up test database schema..."

# Wait for ScyllaDB to be ready
echo "Waiting for ScyllaDB..."
timeout=60
while [ $timeout -gt 0 ]; do
    if docker exec -it $(docker ps | grep scylla | awk '{print $1}' | head -1) cqlsh -e "DESCRIBE KEYSPACES" >/dev/null 2>&1; then
        echo "✅ ScyllaDB is ready"
        break
    fi
    echo "Waiting... ($timeout seconds remaining)"
    sleep 2
    timeout=$((timeout-2))
done

if [ $timeout -le 0 ]; then
    echo "❌ ScyllaDB failed to become ready within 60 seconds"
    exit 1
fi

# Create test schema
echo "Creating test keyspace and tables..."
docker exec -i $(docker ps | grep scylla | awk '{print $1}' | head -1) cqlsh < docker/init-schema-test.cql

echo "✅ Test database schema created successfully"