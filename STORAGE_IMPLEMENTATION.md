# Storage Interface Implementation Summary

## Overview
This implementation introduces a configurable storage interface for OpenCode, allowing users to choose between different storage backends for storing sessions, messages, and other application data.

## Architecture

### Driver Pattern
The implementation uses a driver pattern with a common interface (`StorageDriver.Driver`) that all storage backends must implement:

```typescript
interface Driver {
  init(): Promise<void>
  read<T>(key: string[]): Promise<T>
  write<T>(key: string[], content: T): Promise<void>
  update<T>(key: string[], fn: (draft: T) => void): Promise<T>
  list(prefix: string[]): Promise<string[][]>
  remove(key: string[]): Promise<void>
  export(): Promise<ExportData>
  import(data: ExportData): Promise<void>
  close?(): Promise<void>
}
```

### Storage Facade
The `Storage` namespace in `storage.ts` acts as a facade that:
1. Loads the storage configuration
2. Creates the appropriate driver instance
3. Delegates all operations to the driver
4. Maintains the existing API surface for backward compatibility

### Key-Value Model
All drivers use a hierarchical key-value model where:
- Keys are represented as string arrays (e.g., `["project", "proj-1"]`)
- Values are stored as JSON
- Keys are converted to strings using "/" as separator for database storage

## Implemented Drivers

### 1. JSON Driver (`json-driver.ts`)
**Default driver maintaining full backward compatibility**

- Stores data as individual JSON files
- Uses file-based locking for concurrency
- Implements existing migration logic
- Storage path: `~/.local/share/opencode/storage/`

**Pros:**
- No dependencies
- Human-readable format
- Easy to backup and inspect
- Backward compatible

**Cons:**
- Slower for large datasets
- File system limitations
- No built-in querying

### 2. SQLite Driver (`sqlite-driver.ts`)
**Local database storage using Bun's built-in SQLite**

Schema:
```sql
CREATE TABLE storage (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

**Features:**
- Atomic transactions
- WAL mode for better concurrency
- Single-file database
- Built-in to Bun (no dependencies)

**Use Cases:**
- Better performance than JSON
- Local installations with many sessions
- Single-user environments

### 3. PostgreSQL Driver (`postgres-driver.ts`)
**Enterprise-grade database storage**

Schema:
```sql
CREATE TABLE storage (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
)
```

**Features:**
- Connection pooling
- JSONB support for efficient storage
- Network accessible
- Supports multiple concurrent clients

**Use Cases:**
- Multi-user environments
- Cloud deployments
- Enterprise installations
- Shared storage requirements

## Configuration

### Configuration Schema
Added to `config.ts`:

```typescript
storage: z.discriminatedUnion("driver", [
  z.object({
    driver: z.literal("json"),
    path: z.string().optional()
  }),
  z.object({
    driver: z.literal("sqlite"),
    database: z.string().optional()
  }),
  z.object({
    driver: z.literal("postgres"),
    url: z.string(),
    poolSize: z.number().optional()
  }),
]).optional()
```

### Example Configurations

**JSON (default):**
```json
{
  "storage": {
    "driver": "json"
  }
}
```

**SQLite:**
```json
{
  "storage": {
    "driver": "sqlite",
    "database": "~/.local/share/opencode/storage/opencode.db"
  }
}
```

**PostgreSQL:**
```json
{
  "storage": {
    "driver": "postgres",
    "url": "postgres://user:pass@localhost:5432/opencode",
    "poolSize": 10
  }
}
```

## Migration Tools

### Command: `storage:migrate`
Utility for migrating data between storage backends.

**Interactive Mode:**
```bash
opencode storage:migrate
```

**Non-Interactive Mode:**
```bash
opencode storage:migrate \
  --from json \
  --to sqlite \
  --to-config '{"driver":"sqlite","database":"./opencode.db"}'
```

**Export to File:**
```bash
opencode storage:migrate \
  --from sqlite \
  --output backup.json
```

### Migration Process
1. Initialize source driver
2. Export all data to intermediate format
3. Initialize destination driver
4. Import data into destination
5. Cleanup resources

### Export Format
```typescript
interface ExportData {
  version: number
  timestamp: number
  projects: Array<{ key: string[]; content: any }>
  sessions: Array<{ key: string[]; content: any }>
  messages: Array<{ key: string[]; content: any }>
  parts: Array<{ key: string[]; content: any }>
  session_diffs: Array<{ key: string[]; content: any }>
}
```

## Testing

### Test Coverage
Created `storage.test.ts` with comprehensive tests for:

1. **CRUD Operations**
   - Read/Write data
   - Update atomically
   - Remove data

2. **Listing**
   - List keys by prefix
   - Ensure correct prefix filtering

3. **Export/Import**
   - Export to intermediate format
   - Import from intermediate format
   - Data integrity validation

4. **Cross-Driver Migration**
   - JSON to SQLite migration
   - Data preservation
   - Schema compatibility

### Running Tests
```bash
cd packages/opencode
bun test src/storage/storage.test.ts
```

## Security Considerations

### CodeQL Analysis
- No security vulnerabilities detected
- All database queries use parameterized statements
- No SQL injection risks

### Data Protection
- JSON driver maintains existing file permissions
- SQLite uses WAL mode for crash recovery
- PostgreSQL supports SSL connections (configured via URL)

### Locking
- JSON driver uses file-based locks
- SQLite uses database-level locking
- PostgreSQL uses row-level locking

## Documentation

### Created Documentation
1. **`packages/docs/storage.mdx`**
   - Comprehensive storage guide
   - Driver comparisons
   - Migration procedures
   - Troubleshooting

2. **Example Configurations**
   - `packages/docs/examples/storage-json.json`
   - `packages/docs/examples/storage-sqlite.json`
   - `packages/docs/examples/storage-postgres.json`

## Backward Compatibility

### Default Behavior
- Defaults to JSON driver if no configuration specified
- Existing installations continue working without changes
- No breaking changes to existing APIs

### Migration Path
Users can migrate gradually:
1. Continue using JSON (default)
2. Test SQLite on non-production data
3. Migrate production data when ready
4. Update configuration

## Future Enhancements

### Potential Additions
1. **Redis Driver** - For distributed caching
2. **MongoDB Driver** - For document-oriented storage
3. **S3 Driver** - For cloud object storage
4. **Compression** - Reduce storage size
5. **Encryption** - At-rest encryption for sensitive data

### Performance Optimizations
1. **Caching Layer** - In-memory cache for frequently accessed data
2. **Batch Operations** - Optimize multiple reads/writes
3. **Connection Pooling** - Better resource management for database drivers

## Files Modified/Created

### Core Implementation
- `packages/opencode/src/storage/driver.ts` - Interface definition
- `packages/opencode/src/storage/json-driver.ts` - JSON implementation
- `packages/opencode/src/storage/sqlite-driver.ts` - SQLite implementation
- `packages/opencode/src/storage/postgres-driver.ts` - PostgreSQL implementation
- `packages/opencode/src/storage/storage.ts` - Updated facade

### Configuration
- `packages/opencode/src/config/config.ts` - Added storage config schema

### CLI
- `packages/opencode/src/cli/cmd/storage-migrate.ts` - Migration command
- `packages/opencode/src/index.ts` - Register new command

### Documentation
- `packages/docs/storage.mdx` - User guide
- `packages/docs/examples/storage-*.json` - Example configs

### Testing
- `packages/opencode/src/storage/storage.test.ts` - Test suite

## Summary

This implementation successfully introduces a flexible, configurable storage system for OpenCode while maintaining full backward compatibility. Users can now choose the storage backend that best fits their needs, from simple file-based JSON to enterprise PostgreSQL, with easy migration between backends.

The driver pattern ensures extensibility, making it straightforward to add new storage backends in the future. The comprehensive documentation and migration tools provide users with clear guidance for adopting and transitioning between different storage solutions.
