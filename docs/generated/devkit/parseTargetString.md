# Function: parseTargetString

▸ **parseTargetString**(`targetString`, `projectGraph`): [`Target`](/reference/core-api/devkit/documents/Target)

Parses a target string into {project, target, configuration}

Examples:

```typescript
parseTargetString('proj:test', graph); // returns { project: "proj", target: "test" }
parseTargetString('proj:test:production', graph); // returns { project: "proj", target: "test", configuration: "production" }
```

#### Parameters

| Name           | Type                                                                | Description      |
| :------------- | :------------------------------------------------------------------ | :--------------- |
| `targetString` | `string`                                                            | target reference |
| `projectGraph` | [`ProjectGraph`](/reference/core-api/devkit/documents/ProjectGraph) | -                |

#### Returns

[`Target`](/reference/core-api/devkit/documents/Target)

▸ **parseTargetString**(`targetString`, `ctx`): [`Target`](/reference/core-api/devkit/documents/Target)

Parses a target string into {project, target, configuration}. Passing a full
[ExecutorContext](/reference/core-api/devkit/documents/ExecutorContext) enables the targetString to reference the current project.

Examples:

```typescript
parseTargetString('test', executorContext); // returns { project: "proj", target: "test" }
parseTargetString('proj:test', executorContext); // returns { project: "proj", target: "test" }
parseTargetString('proj:test:production', executorContext); // returns { project: "proj", target: "test", configuration: "production" }
```

#### Parameters

| Name           | Type                                                                      |
| :------------- | :------------------------------------------------------------------------ |
| `targetString` | `string`                                                                  |
| `ctx`          | [`ExecutorContext`](/reference/core-api/devkit/documents/ExecutorContext) |

#### Returns

[`Target`](/reference/core-api/devkit/documents/Target)
