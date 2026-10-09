import type { Asset, EndpointSpec, NodeKind } from "./schema";

/**
 * Catálogo de assets embutido. Cada asset diz QUE PROBLEMA a tecnologia resolve,
 * para que humanos e LLMs escolham o componente certo.
 * Ícones: Iconify "logos" (l:) e "simple-icons" (s:) — ver scripts/build-icons.ts.
 */
type Row = [
  id: string,
  name: string,
  category: string,
  icon: string,
  color: string,
  kind: NodeKind,
  problem: string,
  description: string,
  tags?: string,
  vendor?: string,
];

const rows: Row[] = [
  // ───────── Genéricos
  ["user", "Usuário", "Genéricos", "g:user", "#706fd3", "actor", "Representar quem usa o sistema.", "Pessoa ou papel (cliente, admin, operador) que interage com o sistema.", "pessoa persona ator"],
  ["web-app", "Aplicação Web", "Genéricos", "g:browser", "#706fd3", "client", "Interface acessada pelo navegador.", "SPA/SSR/site consumindo APIs.", "frontend browser spa"],
  ["mobile-app", "App Mobile", "Genéricos", "g:mobile", "#706fd3", "client", "Interface nativa/híbrida em dispositivos móveis.", "App iOS/Android/Flutter/React Native.", "ios android"],
  ["service", "Serviço", "Genéricos", "g:service", "#706fd3", "service", "Encapsular uma capacidade de negócio.", "Microsserviço ou módulo de backend genérico.", "microservice api backend"],
  ["database", "Banco de Dados", "Genéricos", "g:database", "#2f80ed", "database", "Persistir dados de forma durável.", "Banco de dados genérico (relacional ou NoSQL).", "db storage"],
  ["queue", "Fila / Broker", "Genéricos", "g:queue", "#e08a1e", "queue", "Desacoplar produtores e consumidores.", "Fila de mensagens ou tópico de eventos.", "mensageria broker topic"],
  ["cache", "Cache", "Genéricos", "g:cache", "#d6453d", "cache", "Reduzir latência e carga no banco.", "Cache em memória.", "memoria"],
  ["gateway", "API Gateway", "Genéricos", "g:gateway", "#706fd3", "gateway", "Ponto único de entrada: roteamento, auth, rate limit.", "API gateway / reverse proxy / BFF.", "proxy edge bff"],
  ["external", "Sistema Externo", "Genéricos", "g:cloud", "#7a7a8c", "external", "Representar dependência fora do seu controle.", "SaaS ou API de terceiro (pagamento, e-mail, ERP).", "terceiro saas"],

  // ───────── Linguagens
  ["php", "PHP", "Linguagens", "l:php", "#777bb4", "library", "Linguagem web server-side madura, hospedagem ubíqua.", "Base de Laravel, Symfony, WordPress.", "linguagem"],
  ["python", "Python", "Linguagens", "l:python", "#3776ab", "library", "Produtividade para APIs, automação, dados e IA.", "Linguagem de propósito geral dominante em ML.", "linguagem ml"],
  ["typescript", "TypeScript", "Linguagens", "l:typescript-icon", "#3178c6", "library", "Tipagem estática sobre JavaScript para bases grandes.", "Superset tipado de JS para front e back.", "linguagem js"],
  ["javascript", "JavaScript", "Linguagens", "l:javascript", "#f7df1e", "library", "Linguagem universal da web (browser e Node).", "", "linguagem js"],
  ["java", "Java", "Linguagens", "l:java", "#e76f00", "library", "Sistemas corporativos robustos e de alta performance na JVM.", "", "linguagem jvm"],
  ["kotlin", "Kotlin", "Linguagens", "l:kotlin-icon", "#7f52ff", "library", "JVM mais concisa e segura (null-safety); padrão Android.", "", "linguagem jvm android"],
  ["go", "Go", "Linguagens", "s:go", "#00add8", "library", "Serviços de rede concorrentes, binário único, deploy simples.", "", "linguagem golang"],
  ["rust", "Rust", "Linguagens", "l:rust", "#dea584", "library", "Performance de C com segurança de memória.", "", "linguagem"],
  ["csharp-dotnet", ".NET / C#", "Linguagens", "l:dotnet", "#512bd4", "library", "Plataforma corporativa multiplataforma da Microsoft.", "", "linguagem csharp"],
  ["ruby", "Ruby", "Linguagens", "l:ruby", "#cc342d", "library", "Produtividade e legibilidade (base de Rails).", "", "linguagem"],
  ["swift", "Swift", "Linguagens", "l:swift", "#fa7343", "library", "Desenvolvimento nativo Apple.", "", "linguagem ios"],

  // ───────── Frameworks Backend
  ["laravel", "Laravel", "Frameworks Backend", "l:laravel", "#ff2d20", "service", "Acelera apps PHP com ORM, filas, auth e migrations prontos.", "Framework PHP full-stack (Eloquent, Queues, Horizon).", "php mvc eloquent"],
  ["symfony", "Symfony", "Frameworks Backend", "l:symfony", "#1a171b", "service", "Componentes PHP reutilizáveis e arquitetura enterprise.", "", "php"],
  ["nestjs", "NestJS", "Frameworks Backend", "l:nestjs", "#e0234e", "service", "Estrutura modular e injeção de dependência para Node.", "Framework Node/TypeScript opinativo.", "node typescript"],
  ["express", "Express", "Frameworks Backend", "l:express", "#444444", "service", "HTTP server minimalista em Node.", "", "node http"],
  ["fastapi", "FastAPI", "Frameworks Backend", "l:fastapi-icon", "#009688", "service", "APIs Python rápidas com validação e OpenAPI automáticos.", "", "python openapi async"],
  ["django", "Django", "Frameworks Backend", "l:django-icon", "#0c4b33", "service", "Web apps Python completos (ORM, admin, auth).", "", "python mvc"],
  ["flask", "Flask", "Frameworks Backend", "l:flask", "#444444", "service", "Micro-framework Python flexível.", "", "python"],
  ["spring-boot", "Spring Boot", "Frameworks Backend", "l:spring-icon", "#6db33f", "service", "Microsserviços Java com configuração mínima.", "", "java jvm"],
  ["rails", "Ruby on Rails", "Frameworks Backend", "l:rails", "#cc0000", "service", "Convenção sobre configuração para CRUD rápido.", "", "ruby mvc"],
  ["dotnet-aspnet", "ASP.NET Core", "Frameworks Backend", "l:dotnet", "#512bd4", "service", "APIs e web apps de alta performance em .NET.", "", "csharp"],
  ["hasura", "Hasura", "Frameworks Backend", "l:hasura-icon", "#1eb4d4", "gateway", "GraphQL instantâneo sobre bancos existentes.", "", "graphql"],

  // ───────── Frameworks Frontend
  ["react", "React", "Frameworks Frontend", "l:react", "#61dafb", "client", "UI declarativa por componentes.", "", "spa ui"],
  ["nextjs", "Next.js", "Frameworks Frontend", "l:nextjs-icon", "#000000", "client", "SSR/SSG e roteamento para React com SEO.", "", "react ssr"],
  ["vue", "Vue.js", "Frameworks Frontend", "l:vue", "#42b883", "client", "UI reativa com curva de aprendizado suave.", "", "spa ui"],
  ["angular", "Angular", "Frameworks Frontend", "l:angular-icon", "#dd0031", "client", "Framework completo para SPAs corporativas.", "", "spa typescript"],
  ["svelte", "Svelte", "Frameworks Frontend", "l:svelte-icon", "#ff3e00", "client", "UI compilada, bundle pequeno.", "", "spa"],
  ["tailwind", "Tailwind CSS", "Frameworks Frontend", "l:tailwindcss-icon", "#06b6d4", "library", "Estilização utilitária consistente.", "", "css"],

  // ───────── Bancos de dados
  ["postgresql", "PostgreSQL", "Bancos de Dados", "l:postgresql", "#336791", "database", "Relacional ACID com JSONB, extensões e consultas avançadas.", "Banco relacional open source de uso geral.", "sql relacional"],
  ["mysql", "MySQL", "Bancos de Dados", "l:mysql", "#00758f", "database", "Relacional popular e simples para web apps.", "", "sql relacional"],
  ["mariadb", "MariaDB", "Bancos de Dados", "l:mariadb-icon", "#003545", "database", "Fork open source compatível com MySQL.", "", "sql relacional"],
  ["mongodb", "MongoDB", "Bancos de Dados", "l:mongodb-icon", "#47a248", "database", "Documentos flexíveis (JSON) sem esquema rígido.", "", "nosql documento"],
  ["sqlite", "SQLite", "Bancos de Dados", "l:sqlite", "#003b57", "database", "Banco embutido em arquivo, zero configuração.", "", "sql embedded"],
  ["cassandra", "Cassandra", "Bancos de Dados", "l:cassandra", "#1287b1", "database", "Escrita massiva distribuída com alta disponibilidade.", "", "nosql wide-column"],
  ["neo4j", "Neo4j", "Bancos de Dados", "l:neo4j", "#018bff", "database", "Relacionamentos complexos via grafo.", "", "grafo"],
  ["influxdb", "InfluxDB", "Bancos de Dados", "l:influxdb-icon", "#22adf6", "database", "Séries temporais e métricas.", "", "timeseries"],
  ["snowflake", "Snowflake", "Bancos de Dados", "l:snowflake-icon", "#29b5e8", "database", "Data warehouse em nuvem com separação storage/compute.", "", "dw analytics"],
  ["elasticsearch", "Elasticsearch", "Bancos de Dados", "s:elasticsearch", "#005571", "database", "Busca full-text e analytics em logs.", "", "search"],
  ["redis", "Redis", "Bancos de Dados", "l:redis", "#d82c20", "cache", "Cache, sessões, filas leves e rate limit em memória.", "", "cache"],
  ["memcached", "Memcached", "Bancos de Dados", "l:memcached", "#4a8c3b", "cache", "Cache distribuído simples chave-valor.", "", "cache"],
  ["supabase", "Supabase", "Bancos de Dados", "l:supabase-icon", "#3ecf8e", "database", "Postgres gerenciado + auth + storage + realtime.", "", "baas postgres"],
  ["firebase", "Firebase", "Bancos de Dados", "l:firebase", "#ffca28", "database", "Backend gerenciado com realtime e auth para apps.", "", "baas google"],

  // ───────── Mensageria
  ["kafka", "Apache Kafka", "Mensageria", "l:kafka-icon", "#231f20", "queue", "Log de eventos distribuído para streaming e event sourcing.", "", "stream event"],
  ["rabbitmq", "RabbitMQ", "Mensageria", "l:rabbitmq-icon", "#ff6600", "queue", "Roteamento flexível de mensagens (AMQP) e filas de trabalho.", "", "amqp broker"],
  ["nats", "NATS", "Mensageria", "l:nats-icon", "#27aae1", "queue", "Mensageria leve e rápida para microsserviços.", "", "pubsub"],
  ["sidekiq", "Sidekiq", "Mensageria", "l:sidekiq-icon", "#b1003e", "queue", "Jobs em background para Ruby.", "", "jobs"],
  ["temporal", "Temporal", "Mensageria", "l:temporal-icon", "#141414", "infra", "Workflows duráveis com retry e estado garantidos.", "", "workflow saga"],

  // ───────── API & Protocolos
  ["rest-api", "REST API", "API & Protocolos", "t:REST", "#706fd3", "service", "Contrato HTTP simples e cacheável entre sistemas.", "", "http json"],
  ["graphql", "GraphQL", "API & Protocolos", "l:graphql", "#e10098", "gateway", "Cliente pede exatamente os campos que precisa; evita over/under-fetching.", "", "api"],
  ["grpc", "gRPC", "API & Protocolos", "l:grpc", "#244c5a", "service", "RPC binário tipado (protobuf) de baixa latência.", "", "rpc protobuf"],
  ["swagger", "Swagger / OpenAPI", "API & Protocolos", "l:swagger", "#85ea2d", "library", "Documenta e padroniza contratos REST, gera clientes e testes.", "", "openapi docs"],
  ["postman", "Postman", "API & Protocolos", "l:postman-icon", "#ff6c37", "infra", "Testar e documentar APIs.", "", "test api"],
  ["websocket", "WebSocket", "API & Protocolos", "l:websocket", "#010101", "service", "Canal bidirecional em tempo real.", "", "realtime"],
  ["kong", "Kong", "API & Protocolos", "l:kong-icon", "#003459", "gateway", "API gateway extensível (plugins de auth, rate limit).", "", "gateway"],
  ["nginx", "NGINX", "API & Protocolos", "l:nginx", "#009639", "gateway", "Reverse proxy, load balancer e servidor estático.", "", "proxy lb"],

  // ───────── Infra & DevOps
  ["docker", "Docker", "Infra & DevOps", "l:docker-icon", "#2496ed", "infra", "Empacota app e dependências em containers reproduzíveis.", "", "container"],
  ["kubernetes", "Kubernetes", "Infra & DevOps", "l:kubernetes", "#326ce5", "infra", "Orquestra containers: escala, auto-cura e deploys declarativos.", "", "k8s orchestration"],
  ["terraform", "Terraform", "Infra & DevOps", "l:terraform-icon", "#7b42bc", "infra", "Infraestrutura como código multi-cloud.", "", "iac"],
  ["ansible", "Ansible", "Infra & DevOps", "l:ansible", "#ee0000", "infra", "Automação de configuração sem agente.", "", "config"],
  ["github-actions", "GitHub Actions", "Infra & DevOps", "l:github-actions", "#2088ff", "infra", "CI/CD integrado ao repositório.", "", "ci cd"],
  ["gitlab", "GitLab", "Infra & DevOps", "l:gitlab-icon", "#fc6d26", "infra", "Repositório + CI/CD + DevSecOps em uma plataforma.", "", "ci cd git"],
  ["jenkins", "Jenkins", "Infra & DevOps", "l:jenkins", "#d24939", "infra", "Servidor de automação CI/CD extensível.", "", "ci"],
  ["argocd", "Argo CD", "Infra & DevOps", "l:argo-icon", "#ef7b4d", "infra", "GitOps: cluster sincronizado com o git.", "", "gitops"],
  ["helm", "Helm", "Infra & DevOps", "l:helm", "#0f1689", "infra", "Empacotamento e versionamento de apps Kubernetes.", "", "k8s"],
  ["cloudflare", "Cloudflare", "Infra & DevOps", "l:cloudflare-icon", "#f38020", "infra", "CDN, DNS, WAF e proteção DDoS na borda.", "", "cdn edge waf"],
  ["vercel", "Vercel", "Infra & DevOps", "l:vercel-icon", "#000000", "infra", "Deploy e hosting de front-ends com edge.", "", "hosting"],

  // ───────── Observabilidade
  ["prometheus", "Prometheus", "Observabilidade", "l:prometheus", "#e6522c", "infra", "Coleta e alerta de métricas em séries temporais.", "", "metrics"],
  ["grafana", "Grafana", "Observabilidade", "l:grafana", "#f46800", "infra", "Dashboards unificados de métricas, logs e traces.", "", "dashboard"],
  ["opentelemetry", "OpenTelemetry", "Observabilidade", "l:opentelemetry-icon", "#425cc7", "infra", "Padrão aberto de traces/métricas/logs.", "", "tracing"],
  ["datadog", "Datadog", "Observabilidade", "l:datadog-icon", "#632ca6", "infra", "Observabilidade SaaS full-stack.", "", "apm"],
  ["sentry", "Sentry", "Observabilidade", "l:sentry-icon", "#362d59", "infra", "Rastreio de erros e performance com contexto.", "", "errors"],
  ["kibana", "Kibana", "Observabilidade", "l:kibana", "#005571", "infra", "Exploração visual de logs no Elastic.", "", "logs"],

  // ───────── Segurança & Auth
  ["auth0", "Auth0", "Segurança & Auth", "l:auth0-icon", "#eb5424", "external", "Login, SSO e MFA como serviço — sem construir auth.", "", "identity oauth"],
  ["okta", "Okta", "Segurança & Auth", "l:okta-icon", "#007dc1", "external", "Identidade corporativa e SSO.", "", "identity sso"],
  ["oauth2", "OAuth 2.0 / OIDC", "Segurança & Auth", "l:oauth", "#706fd3", "service", "Delegar autorização e autenticação de forma padronizada.", "", "auth"],
  ["jwt", "JWT", "Segurança & Auth", "l:jwt-icon", "#d63aff", "library", "Tokens assinados stateless para identidade/claims.", "", "token"],
  ["vault", "HashiCorp Vault", "Segurança & Auth", "l:vault-icon", "#ffec6e", "infra", "Gerenciar segredos e rotação de credenciais.", "", "secrets"],
  ["stripe", "Stripe", "Segurança & Auth", "l:stripe", "#635bff", "external", "Pagamentos e assinaturas via API.", "", "payment"],

  // ───────── AWS
  ["aws-lambda", "AWS Lambda", "AWS", "l:aws-lambda", "#ed7100", "service", "Executa código por evento sem gerenciar servidores (paga por uso).", "Compute serverless.", "serverless faas", "AWS"],
  ["aws-ec2", "Amazon EC2", "AWS", "l:aws-ec2", "#ed7100", "infra", "VMs sob demanda com controle total do SO.", "", "vm compute", "AWS"],
  ["aws-ecs", "Amazon ECS", "AWS", "l:aws-ecs", "#ed7100", "infra", "Orquestra containers Docker na AWS.", "", "container", "AWS"],
  ["aws-eks", "Amazon EKS", "AWS", "l:aws-eks", "#ed7100", "infra", "Kubernetes gerenciado.", "", "k8s", "AWS"],
  ["aws-fargate", "AWS Fargate", "AWS", "l:aws-fargate", "#ed7100", "infra", "Containers serverless sem gerenciar nós.", "", "container serverless", "AWS"],
  ["aws-api-gateway", "Amazon API Gateway", "AWS", "l:aws-api-gateway", "#e7157b", "gateway", "Publica e protege APIs (REST/HTTP/WebSocket) com throttling e auth.", "", "api gateway", "AWS"],
  ["aws-cloudfront", "Amazon CloudFront", "AWS", "l:aws-cloudfront", "#8c4fff", "gateway", "CDN global: baixa latência e cache de conteúdo.", "", "cdn", "AWS"],
  ["aws-route53", "Amazon Route 53", "AWS", "l:aws-route53", "#8c4fff", "gateway", "DNS e roteamento por saúde/latência.", "", "dns", "AWS"],
  ["aws-elb", "Elastic Load Balancing", "AWS", "l:aws-elb", "#8c4fff", "gateway", "Distribui tráfego entre instâncias/containers.", "", "lb", "AWS"],
  ["aws-s3", "Amazon S3", "AWS", "l:aws-s3", "#7aa116", "database", "Armazenamento de objetos durável e barato para arquivos, backups e data lakes.", "", "storage object", "AWS"],
  ["aws-dynamodb", "Amazon DynamoDB", "AWS", "l:aws-dynamodb", "#2e73b8", "database", "NoSQL chave-valor serverless com latência de ms em qualquer escala.", "", "nosql", "AWS"],
  ["aws-rds", "Amazon RDS", "AWS", "l:aws-rds", "#2e73b8", "database", "Bancos relacionais gerenciados (backup, failover).", "", "sql", "AWS"],
  ["aws-aurora", "Amazon Aurora", "AWS", "l:aws-aurora", "#2e73b8", "database", "MySQL/Postgres de alta performance e disponibilidade.", "", "sql", "AWS"],
  ["aws-elasticache", "Amazon ElastiCache", "AWS", "l:aws-elasticache", "#2e73b8", "cache", "Redis/Memcached gerenciados.", "", "cache", "AWS"],
  ["aws-redshift", "Amazon Redshift", "AWS", "l:aws-redshift", "#2e73b8", "database", "Data warehouse analítico.", "", "dw", "AWS"],
  ["aws-sqs", "Amazon SQS", "AWS", "l:aws-sqs", "#e7157b", "queue", "Fila gerenciada para desacoplar e absorver picos.", "", "queue", "AWS"],
  ["aws-sns", "Amazon SNS", "AWS", "l:aws-sns", "#e7157b", "queue", "Pub/sub e notificações fan-out.", "", "pubsub", "AWS"],
  ["aws-eventbridge", "Amazon EventBridge", "AWS", "l:aws-eventbridge", "#e7157b", "queue", "Barramento de eventos com regras e integração SaaS.", "", "events bus", "AWS"],
  ["aws-kinesis", "Amazon Kinesis", "AWS", "l:aws-kinesis", "#8c4fff", "queue", "Ingestão e processamento de streams em tempo real.", "", "stream", "AWS"],
  ["aws-msk", "Amazon MSK", "AWS", "l:aws-msk", "#8c4fff", "queue", "Kafka gerenciado.", "", "kafka", "AWS"],
  ["aws-step-functions", "AWS Step Functions", "AWS", "l:aws-step-functions", "#e7157b", "service", "Orquestra fluxos serverless com estado e retry.", "", "workflow", "AWS"],
  ["aws-cognito", "Amazon Cognito", "AWS", "l:aws-cognito", "#dd344c", "external", "Autenticação/usuários para apps web e mobile.", "", "auth", "AWS"],
  ["aws-iam", "AWS IAM", "AWS", "l:aws-iam", "#dd344c", "infra", "Controle de acesso a recursos AWS.", "", "security", "AWS"],
  ["aws-secrets-manager", "AWS Secrets Manager", "AWS", "l:aws-secrets-manager", "#dd344c", "infra", "Guarda e rotaciona segredos.", "", "secrets", "AWS"],
  ["aws-cloudwatch", "Amazon CloudWatch", "AWS", "l:aws-cloudwatch", "#e7157b", "infra", "Logs, métricas e alarmes.", "", "observability", "AWS"],
  ["aws-cloudformation", "AWS CloudFormation", "AWS", "l:aws-cloudformation", "#e7157b", "infra", "IaC nativo da AWS.", "", "iac", "AWS"],
  ["aws-vpc", "Amazon VPC", "AWS", "l:aws-vpc", "#8c4fff", "infra", "Rede virtual isolada.", "", "network", "AWS"],
  ["aws-glue", "AWS Glue", "AWS", "l:aws-glue", "#8c4fff", "infra", "ETL serverless e catálogo de dados.", "", "etl", "AWS"],
  ["aws-athena", "Amazon Athena", "AWS", "l:aws-athena", "#8c4fff", "database", "SQL direto sobre dados no S3.", "", "analytics", "AWS"],
  ["aws-bedrock", "Amazon Bedrock", "AWS", "t:BR", "#01a88d", "ai", "API única para modelos de fundação (Claude, Nova, Llama).", "", "llm genai", "AWS"],
  ["aws-sagemaker", "Amazon SageMaker", "AWS", "t:SM", "#01a88d", "ai", "Treinar, hospedar e operar modelos de ML.", "", "ml", "AWS"],

  // ───────── Google Cloud
  ["gcp-cloud-run", "Cloud Run", "Google Cloud", "l:google-cloud-run", "#4285f4", "service", "Containers serverless que escalam a zero.", "", "serverless container", "Google"],
  ["gcp-functions", "Cloud Functions", "Google Cloud", "l:google-cloud-functions", "#4285f4", "service", "Funções serverless orientadas a eventos.", "", "faas", "Google"],
  ["gcp-gke", "Google Kubernetes Engine", "Google Cloud", "l:kubernetes", "#4285f4", "infra", "Kubernetes gerenciado do Google.", "", "k8s", "Google"],
  ["gcp-bigquery", "BigQuery", "Google Cloud", "t:BQ", "#669df6", "database", "Data warehouse serverless para análises em escala de petabytes.", "", "dw analytics", "Google"],
  ["gcp-pubsub", "Pub/Sub", "Google Cloud", "t:PS", "#669df6", "queue", "Mensageria global assíncrona.", "", "pubsub", "Google"],
  ["gcp-platform", "Google Cloud", "Google Cloud", "l:google-cloud", "#4285f4", "infra", "Plataforma de nuvem do Google.", "", "cloud", "Google"],
  ["gemini", "Google Gemini", "Google Cloud", "l:google-gemini-icon", "#8e75b2", "ai", "Modelos multimodais do Google via API.", "", "llm", "Google"],

  // ───────── Azure / IBM
  ["azure", "Microsoft Azure", "Azure & IBM", "l:microsoft-azure", "#0078d4", "infra", "Plataforma de nuvem da Microsoft.", "", "cloud", "Microsoft"],
  ["ibm", "IBM Cloud", "Azure & IBM", "l:ibm", "#0f62fe", "infra", "Nuvem híbrida e soluções corporativas IBM.", "", "cloud", "IBM"],
  ["ibm-watsonx", "IBM watsonx", "Azure & IBM", "t:wx", "#0f62fe", "ai", "Plataforma de IA corporativa com governança.", "", "ai llm", "IBM"],
  ["ibm-mq", "IBM MQ", "Azure & IBM", "t:MQ", "#0f62fe", "queue", "Mensageria corporativa com entrega garantida.", "", "broker", "IBM"],

  // ───────── IA / LLM
  ["anthropic-claude", "Anthropic Claude", "IA & LLM", "l:anthropic-icon", "#d97757", "ai", "LLM para raciocínio, código e agentes via API.", "", "llm claude", "Anthropic"],
  ["openai", "OpenAI", "IA & LLM", "l:openai-icon", "#10a37f", "ai", "Modelos GPT, embeddings e imagem via API.", "", "llm gpt", "OpenAI"],
  ["mistral", "Mistral AI", "IA & LLM", "l:mistral-ai-icon", "#fa520f", "ai", "LLMs abertos e comerciais europeus.", "", "llm", "Mistral"],
  ["huggingface", "Hugging Face", "IA & LLM", "l:hugging-face-icon", "#ffd21e", "ai", "Hub de modelos e inferência.", "", "ml models", "Hugging Face"],
  ["langchain", "LangChain", "IA & LLM", "l:langchain-icon", "#1c3c3c", "library", "Orquestra chamadas de LLM, ferramentas e RAG.", "", "agents rag", "LangChain"],
  ["mcp", "MCP Server", "IA & LLM", "t:MCP", "#706fd3", "service", "Expõe ferramentas e dados a LLMs de forma padronizada (Model Context Protocol).", "", "tools agents", "Anthropic"],
  ["vector-db", "Vector DB", "IA & LLM", "g:database", "#8e75b2", "database", "Busca semântica por embeddings (RAG).", "Pinecone, pgvector, Qdrant, Weaviate.", "rag embeddings"],
  // ───────── Modelos de IA (famílias; defina a versão exata em "Tecnologia")
  ["claude-fable", "Claude Fable", "Modelos de IA", "l:claude-icon", "#d97757", "ai", "Máxima capacidade de raciocínio para tarefas longas e agentes complexos, quando qualidade pesa mais que custo.", "Linha de topo da Anthropic. Ex.: claude-fable-5-1.", "llm claude anthropic reasoning agents", "Anthropic"],
  ["claude-opus", "Claude Opus", "Modelos de IA", "l:claude-icon", "#d97757", "ai", "Raciocínio profundo, código e análise difíceis com alta precisão.", "Camada de alta capacidade. Ex.: claude-opus-5-5.", "llm claude anthropic code", "Anthropic"],
  ["claude-sonnet", "Claude Sonnet", "Modelos de IA", "l:claude-icon", "#d97757", "ai", "Equilíbrio entre qualidade, velocidade e custo para produção: agentes, código e chat.", "Escolha padrão para a maioria dos produtos. Ex.: claude-sonnet-5-5.", "llm claude anthropic balanced", "Anthropic"],
  ["claude-haiku", "Claude Haiku", "Modelos de IA", "l:claude-icon", "#d97757", "ai", "Respostas rápidas e baratas para classificação, extração, roteamento e alto volume.", "Camada rápida. Ex.: claude-haiku-4-5.", "llm claude anthropic fast cheap", "Anthropic"],
  ["openai-gpt", "OpenAI GPT", "Modelos de IA", "l:openai-icon", "#10a37f", "ai", "Modelo de propósito geral (texto, visão, ferramentas) com grande ecossistema de integrações.", "Família GPT via API ou ChatGPT.", "llm gpt openai multimodal", "OpenAI"],
  ["openai-reasoning", "OpenAI o-series", "Modelos de IA", "l:openai-icon", "#10a37f", "ai", "Raciocínio passo a passo para matemática, ciência e problemas de código difíceis.", "Modelos de raciocínio da OpenAI (série o).", "llm reasoning openai", "OpenAI"],
  ["openai-embeddings", "OpenAI Embeddings", "Modelos de IA", "l:openai-icon", "#10a37f", "ai", "Transforma texto em vetores para busca semântica, RAG e clustering.", "Modelos text-embedding.", "embeddings rag vector", "OpenAI"],
  ["whisper", "Whisper", "Modelos de IA", "l:openai-icon", "#10a37f", "ai", "Transcrição de fala para texto em muitos idiomas.", "Modelo de reconhecimento de voz (API ou local).", "speech stt audio", "OpenAI"],
  ["gemini-pro", "Gemini Pro", "Modelos de IA", "l:google-gemini-icon", "#8e75b2", "ai", "Raciocínio multimodal com contexto muito longo (texto, imagem, áudio, vídeo).", "Modelos de maior capacidade do Google.", "llm gemini google multimodal long-context", "Google"],
  ["gemini-flash", "Gemini Flash", "Modelos de IA", "l:google-gemini-icon", "#8e75b2", "ai", "Baixa latência e custo para alto volume e uso interativo.", "Camada rápida do Gemini.", "llm gemini google fast", "Google"],
  ["llama", "Meta Llama", "Modelos de IA", "l:meta-icon", "#0668e1", "ai", "LLM de pesos abertos para rodar em infraestrutura própria, com controle de dados e custo.", "Família Llama (self-hosted, Bedrock, Ollama…).", "llm open-source self-hosted meta", "Meta"],
  ["mistral-large", "Mistral Large", "Modelos de IA", "l:mistral-ai-icon", "#fa520f", "ai", "LLM europeu de alta capacidade, com opção de hospedagem própria e residência de dados.", "Mistral Large / Mixtral / Codestral.", "llm mistral eu", "Mistral"],
  ["deepseek", "DeepSeek", "Modelos de IA", "l:deepseek-icon", "#4d6bfe", "ai", "Modelos abertos de raciocínio e código com ótimo custo-benefício.", "DeepSeek V/R.", "llm reasoning open-source code", "DeepSeek"],
  ["qwen", "Qwen", "Modelos de IA", "l:qwen-icon", "#615ced", "ai", "Modelos abertos multilíngues e de código em vários tamanhos, de edge a servidor.", "Família Qwen (Alibaba).", "llm open-source multilingual", "Alibaba"],
  ["grok", "xAI Grok", "Modelos de IA", "l:grok-icon", "#111111", "ai", "LLM com acesso a dados em tempo real da plataforma X.", "Modelos Grok via API da xAI.", "llm xai realtime", "xAI"],
  ["amazon-nova", "Amazon Nova", "Modelos de IA", "t:Nova", "#01a88d", "ai", "Modelos de fundação da AWS, integrados ao Bedrock, para texto e multimodal com bom custo.", "Família Nova (Micro, Lite, Pro, Premier).", "llm bedrock aws", "AWS"],
  ["cohere-command", "Cohere Command", "Modelos de IA", "t:Co", "#39594d", "ai", "LLM focado em empresas: RAG com citações, reranking e embeddings multilíngues.", "Command, Embed e Rerank.", "llm rag rerank enterprise", "Cohere"],
  ["perplexity-sonar", "Perplexity Sonar", "Modelos de IA", "l:perplexity-icon", "#20808d", "ai", "Respostas com busca na web e citações de fontes.", "API Sonar.", "llm search web citations", "Perplexity"],
  ["stable-diffusion", "Stable Diffusion", "Modelos de IA", "l:stability-ai-icon", "#7c3aed", "ai", "Geração de imagens a partir de texto, aberta e hospedável.", "Stability AI.", "image generation open-source", "Stability AI"],
  ["ollama", "Ollama", "Modelos de IA", "s:ollama", "#1f1f1f", "infra", "Executa LLMs abertos localmente com uma API simples — privacidade e desenvolvimento offline.", "Runtime local para Llama, Qwen, Mistral, etc.", "local self-hosted runtime", "Ollama"],
  ["hf-inference", "Hugging Face Inference", "Modelos de IA", "s:huggingface", "#ffd21e", "ai", "Hospeda e serve milhares de modelos abertos por API ou endpoints dedicados.", "Hub + Inference Endpoints.", "models hosting open-source", "Hugging Face"],
];

const base: Asset[] = rows.map(
  ([id, name, category, icon, color, kind, problem, description, tags, vendor]) => ({
    id,
    name,
    category,
    icon,
    color,
    kind,
    problem,
    description: description || problem,
    tags: (tags ?? "").split(" ").filter(Boolean),
    vendor,
    builtin: true,
  }),
);

/** Componentes de comunicação: ao soltar sobre um serviço, passam a pertencer a ele (como nós de gatilho/ação no n8n). */
const ep = (id: string, name: string, badge: string, color: string, endpoint: EndpointSpec, problem: string, tags: string): Asset => ({
  id,
  name,
  category: "Comunicação",
  icon: `t:${badge}`,
  color,
  kind: "endpoint",
  endpoint,
  problem,
  description: problem,
  tags: tags.split(" "),
  builtin: true,
});

const comm: Asset[] = [
  ep("ep-get", "Endpoint GET", "GET", "#14a38b", { protocol: "rest", method: "GET", path: "/resource" }, "Consultar um recurso sem efeitos colaterais (idempotente e cacheável).", "rest http read endpoint"),
  ep("ep-post", "Endpoint POST", "POST", "#2f80ed", { protocol: "rest", method: "POST", path: "/resource" }, "Criar um recurso ou disparar uma ação que altera estado.", "rest http create endpoint"),
  ep("ep-put", "Endpoint PUT", "PUT", "#e08a1e", { protocol: "rest", method: "PUT", path: "/resource/{id}" }, "Substituir um recurso inteiro de forma idempotente.", "rest http update endpoint"),
  ep("ep-patch", "Endpoint PATCH", "PATCH", "#7a5af8", { protocol: "rest", method: "PATCH", path: "/resource/{id}" }, "Alterar parcialmente um recurso, sem reenviar tudo.", "rest http update endpoint"),
  ep("ep-delete", "Endpoint DELETE", "DEL", "#d6453d", { protocol: "rest", method: "DELETE", path: "/resource/{id}" }, "Remover um recurso.", "rest http remove endpoint"),
  ep("ep-websocket", "WebSocket", "WS", "#0ea5a5", { protocol: "websocket", path: "/ws" }, "Comunicação bidirecional em tempo real (chat, painéis, jogos) sem polling.", "websocket realtime socket channel"),
  ep("ep-gql-query", "GraphQL Query", "QRY", "#e10098", { protocol: "graphql", method: "query", path: "orders(id)" }, "O cliente pede exatamente os campos de que precisa em uma leitura.", "graphql query read"),
  ep("ep-gql-mutation", "GraphQL Mutation", "MUT", "#e10098", { protocol: "graphql", method: "mutation", path: "createOrder(input)" }, "Alterar dados via GraphQL com retorno tipado.", "graphql mutation write"),
  ep("ep-gql-subscription", "GraphQL Subscription", "SUB", "#e10098", { protocol: "graphql", method: "subscription", path: "orderUpdated(id)" }, "Receber atualizações em tempo real de um schema GraphQL.", "graphql subscription realtime"),
  ep("ep-grpc", "gRPC método", "RPC", "#3b6a7a", { protocol: "grpc", method: "unary", path: "OrderService/GetOrder" }, "Chamada RPC binária e tipada (protobuf) entre serviços, de baixa latência.", "grpc rpc protobuf"),
  ep("ep-webhook", "Webhook (recebe)", "HOOK", "#f97316", { protocol: "webhook", method: "POST", path: "/webhooks/provider" }, "Receber eventos de sistemas externos por push, sem polling.", "webhook callback inbound"),
  ep("ep-sse", "SSE stream", "SSE", "#0891b2", { protocol: "sse", path: "/events" }, "Stream unidirecional servidor → cliente sobre HTTP simples (notificações, progresso).", "sse stream push"),
  ep("ep-event-pub", "Evento publicado", "PUB", "#e08a1e", { protocol: "event", method: "PUBLISH", path: "order.created" }, "Anunciar que algo aconteceu, sem conhecer quem consome.", "event publish topic"),
  ep("ep-event-sub", "Evento consumido", "SUB", "#e08a1e", { protocol: "event", method: "SUBSCRIBE", path: "payment.confirmed" }, "Reagir a eventos de outros serviços de forma desacoplada.", "event subscribe topic consumer"),
];

const refAsset: Asset = {
  id: "diagram-ref",
  name: "Outro diagrama",
  category: "Genéricos",
  icon: "g:layers",
  color: "#706fd3",
  kind: "system",
  problem: "Relacionar este diagrama a um sistema já desenhado em outro, sem duplicar nada.",
  description: "Referência a outro diagrama do cofre (ou a um componente dele). Abra com um clique e veja os backlinks.",
  tags: ["referencia", "link", "sistema", "diagrama", "c4"],
  builtin: true,
};

const generic = base.filter((a) => a.category === "Genéricos");
export const BUILTIN_ASSETS: Asset[] = [...generic.slice(0, 1), refAsset, ...generic.slice(1), ...comm, ...base.filter((a) => a.category !== "Genéricos")];

export const ASSET_CATEGORIES = Array.from(new Set(BUILTIN_ASSETS.map((a) => a.category)));

export function searchAssets(assets: Asset[], query = "", category?: string): Asset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((a) => {
    if (category && a.category !== category) return false;
    if (!q) return true;
    return [a.id, a.name, a.category, a.vendor ?? "", a.problem, a.description, a.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}
