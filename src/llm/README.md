# llm

LLM 统一调用与配置：封装 OpenAI chat completion，供 parser、extractor 复用。

- **config**：从环境变量读取 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL
- **chatJson**：发送 prompt，返回 JSON 对象，供 parser/extractor 的 LLM 模式使用
