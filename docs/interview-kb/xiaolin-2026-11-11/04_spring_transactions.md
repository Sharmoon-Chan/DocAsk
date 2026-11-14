# Java 高频面试学习笔记：Spring 与事务

基于小林coding公开资料学习整理，非官方原文、非官方知识库。以下主题按 Java 后端复习价值选取，“高频”不表示统计排名。整理日期：2026-11-11。事务默认讨论 Spring 代理模式及常见 JDBC 本地事务；版本、代理类型和事务管理器会影响边界。

## Q01 Spring IoC 与 DI 有什么关系，为什么常用构造器注入？

IoC 是把对象创建和依赖组装的控制权交给外部容器，DI 是通过构造器、Setter 或字段把依赖传给对象的一种实现方式。业务组件依赖接口，由容器选择具体实现，便于替换与测试；不使用 Spring、手动把依赖传入构造器，也属于依赖注入。必需依赖通常放在构造器，能清楚表达对象创建所需条件，支持 final 引用，也能直接用替身对象做单元测试。final 只限制引用重新赋值，不让依赖对象自动线程安全。候选 Bean 不唯一时可用 Qualifier 或 Primary 明确选择，不应靠碰巧匹配的名称掩盖设计歧义。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q02 Spring 的 singleton Bean 天然线程安全吗，prototype 是每个请求一个吗？

singleton 表示同一容器、同一 Bean 定义通常复用一个实例，不表示该对象的方法自动加锁。无状态 Service 较容易安全共享；如果把当前用户、临时请求数据放在成员字段，多请求并发时仍可能互相覆盖。prototype 表示每次向容器请求该 Bean 时创建新对象，并不等于每个 HTTP 请求自动创建一个。直接把 prototype 注入 singleton，通常只在单例创建时获取一次；每次需要新实例时可使用 ObjectProvider 等方式。request 作用域才对应 Web 请求生命周期。prototype 的创建初始化由容器完成，交付后的销毁和资源清理通常由使用方负责。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q03 Spring Bean 从创建到销毁经历哪些主要步骤？

可以按实例化、依赖填充、初始化前处理、初始化回调、初始化后处理、使用、销毁来理解。初始化回调包括 PostConstruct、InitializingBean 和配置的 init 方法，不同扩展点处在各自阶段；BeanPostProcessor 可处理或替换实例，AOP 代理常在相应后置处理流程中产生。BeanFactoryPostProcessor 则主要在普通 Bean 创建前修改定义信息，两者不能混为一谈。构造器执行完不代表属性已注入或代理已准备好，因此不要在初始化回调中默认当前对象的事务代理已经生效。容器关闭时会管理单例的销毁回调，prototype 对象的后续清理通常需要调用方负责。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q04 Spring AOP 怎样实现，JDK 动态代理和 CGLIB 有什么限制？

Spring AOP 通常在目标对象外建立代理，把事务、日志等通知组织成拦截器链，外部通过代理调用匹配方法时执行增强。JDK 动态代理面向接口，CGLIB 通过生成目标类的子类实现类代理；后者无法覆盖 private 或 final 方法，也不能为 final 类正常创建这种子类代理。代理选择既看目标类型，也看配置，Spring Boot 常见默认配置偏向类代理，不能仅凭“实现了接口”判断一定使用 JDK 代理。自己 new 的对象和直接 this 自调用通常绕过 Spring 代理。Spring AOP 以方法执行为主要连接点，不能直接等同于 AspectJ 的编译期或类加载期织入。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q05 Spring 三级缓存能解决所有循环依赖吗？

常见三级缓存分别保存最终单例、已生成的早期引用、用于取得早期引用的工厂。允许循环依赖时，某个单例完成实例化后可先暴露工厂；其他 Bean 确实需要它时，再按需产生原始引用或早期代理，避免依赖方持有原对象、外部却拿到另一套代理引用。它主要处理特定的单例 Setter 或字段依赖，双方都必须先在构造器中获得对方、或 prototype 之间循环，不能靠这套机制解决。Spring Boot 2.6 起默认禁止循环依赖，`spring.main.allow-circular-references=true` 也只是允许尝试支持的情况。优先拆分职责或用协调服务，不能把开启配置当作通用修复。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q06 this 调用带有 @Transactional 的方法，事务到底会不会生效？

默认代理模式下，this 调用不会再次经过事务拦截器，所以被调用方法上的事务配置不会因为这个调用而启用。但如果外层方法已经通过代理开启事务，内层数据库操作仍可能参与外层已有事务。比如外层 REQUIRED 方法内部调用标记 REQUIRES_NEW 的方法，实际可能没有创建预期的独立事务，而是仍在原事务里执行。需要独立事务时，常见做法是拆到另一个 Spring Bean，经代理调用，或使用 TransactionTemplate 明确划分边界。异步任务也不会自动继承调用线程的 JDBC 事务；它若通过自己的代理开事务，那是另一个事务。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q07 @Transactional 默认遇到哪些异常回滚，为什么 catch 后还可能提交？

常见默认规则是 RuntimeException 和 Error 触发回滚，受检异常默认不触发；业务需要时可设置 `rollbackFor = Exception.class`，具体仍以项目回滚规则和管理器为准。事务拦截器在代理调用边界观察结果，如果目标方法把异常捕获后正常返回，又没有将事务标记 rollback-only，就可能正常提交。反过来，内层参与同一事务的方法已将事务标为只能回滚，外层仅仅 catch 并不能恢复可提交状态，提交时可能得到 UnexpectedRollbackException。排查时先确认调用是否经过代理、异常是否符合规则以及传播行为，不应把“抛异常却没回滚”一律归因于注解失效。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q08 REQUIRED、REQUIRES_NEW 和 NESTED 有什么差别？

REQUIRED 在已有事务中参与执行，没有事务时新建，是常见默认选项。REQUIRES_NEW 挂起外层事务并创建独立事务，内层提交后，外层后续回滚不会撤销它；JDBC 场景通常还要额外占用连接，需考虑连接池容量和相互等待。NESTED 通常利用同一物理事务中的保存点，内层可以回滚到保存点，但外层最终回滚时仍撤销内层修改，内层成功不代表独立提交。NESTED 依赖事务管理器和底层资源支持，不能直接套到所有 JPA/JTA 场景。传播行为处理方法间的事务关系，隔离级别处理并发事务的数据可见性，两者回答方向不同。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q09 Spring Boot 自动配置怎样生效，spring.factories 还在用吗？

SpringBootApplication 组合配置类、组件扫描和自动配置入口。自动配置导入选择器读取候选配置，处理排除与排序，再由 ConditionalOnClass、ConditionalOnMissingBean、ConditionalOnProperty 等条件决定配置及 Bean 是否注册。它不是把依赖包里的全部类扫描成 Bean，用户自己提供组件后，相关条件可让默认配置退让。版本上，Boot 2.6 及以前常从 spring.factories 的 EnableAutoConfiguration 条目注册，2.7 引入 AutoConfiguration.imports，3.x 起不再用旧条目注册自动配置类。spring.factories 仍可服务其他扩展点，因此不能说整个文件机制被废弃。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。

## Q10 Spring MVC 一次请求如何到达 Controller，统一异常处理在哪一层？

普通 Servlet 请求先经过过滤器链，到达 DispatcherServlet 后，由 HandlerMapping 找到处理器与拦截器，再选择 HandlerAdapter 完成参数解析、校验和方法调用。返回对象时，RestController 常通过消息转换器写成响应体；返回视图时则走视图解析与渲染，两条路径不能混淆。Controller 请求处理中的异常由 HandlerExceptionResolver 体系处理，ExceptionHandler 与 ControllerAdvice 是常用入口。过滤器在进入 DispatcherServlet 前抛出的异常，以及独立线程的异常，不会自动被同一套 Advice 接住。需要统一修改 JSON 响应时，应考虑 ResponseBodyAdvice，而非假设 postHandle 执行时响应还没有写出。

来源：[小林coding：Spring面试题](https://xiaolincoding.com/interview/spring.html)。
