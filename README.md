# payment-webhook-pipeline

> Work in progress. Reference implementation of a reliable payment-webhook pipeline.

A payment gateway calls your webhook. You must answer fast, never lose the event, never process it twice, and retry when a downstream step fails. This repository shows one way to do it:

- signature-checked ingest that answers in milliseconds
- transactional outbox (no event lost between the database and the broker)
- RabbitMQ with idempotent consumers and manual acks
- retries with exponential backoff and a dead-letter queue
- end-to-end tracing and queue metrics (OpenTelemetry)
- the same queue contract on AWS SQS (LocalStack)

All data is fictional and the gateway is a simulator. This is an open-source study project, not a production system.

Built with an AI-agent workflow (tests first, independent review), reviewed and defended by the author. Each step has a short write-up in `docs/learn/` and a "break it yourself" exercise.

License: MIT.
