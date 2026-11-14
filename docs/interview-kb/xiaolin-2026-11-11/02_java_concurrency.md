# Java 高频面试学习笔记：并发与线程池

基于小林coding公开资料学习整理，非官方原文、非官方知识库。以下十题覆盖并发复习中的常见核心主题；“高频”是复习优先级，不是统计榜单。整理日期：2026-11-11，涉及 HotSpot 或 JDK 实现时明确版本边界。

## Q01 volatile 能保证什么，为什么 volatile int 的自增仍不安全？

volatile 主要提供可见性和特定的有序性保证：对该变量的写，happens-before 后续对同一变量的读，适合发布停止标志等简单状态。它不会把任意复合操作变成原子操作。`count++` 包含读取、计算和写回，即使 count 是 volatile，两个线程仍可能读到同一旧值，最后丢失一次更新。计数可使用 AtomicInteger，多个字段必须保持整体约束时通常需要同一把锁。happens-before 描述可观察结果的保证，不等于禁止全部底层重排；JMM 的工作内存也是抽象模型，不能直接等同于线程栈或某一层 CPU 缓存。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q02 synchronized 与 ReentrantLock 有哪些差别？

两者都能提供互斥、可重入和正确使用下的可见性。synchronized 依赖监视器，退出同步区域时由语言机制释放锁；ReentrantLock 需要显式加锁，并在 finally 中 unlock。后者提供 `tryLock()`、超时获取、`lockInterruptibly()`、可选公平策略，以及多个 Condition，适合需要取消或分别等待多个条件的场景。公平锁也不等于操作系统调度完全公平，通常还要权衡吞吐。性能应根据竞争程度与 JDK 实现测量，不能固定断言一种总比另一种快。传统“偏向锁、轻量级锁、重量级锁”是版本相关实现，不能原样套到所有现代 JDK。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q03 CAS 是什么，ABA 问题为什么需要版本信息？

CAS 是比较并交换：只有内存中的当前值等于预期旧值，才原子地写入新值，否则失败。Java 原子类利用这类机制实现并发更新，失败后可能重试。CAS 只比较当前值，无法知道它曾从 A 变为 B 又变回 A，因此某些依赖中间状态的算法会出现 ABA 问题，可使用带版本戳的 `AtomicStampedReference` 等方案区分。不是所有计数场景都受 ABA 影响，应先分析业务语义。竞争激烈时反复失败会消耗 CPU，而且单个变量的 CAS 不能自动保证多个字段共同变化；必要时将状态合并，或改用锁保护整体操作。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q04 AQS 解决什么问题，它和 CAS、ReentrantLock 是什么关系？

AQS 是构建锁和同步器的基础框架，负责同步状态、等待队列、阻塞与唤醒；CAS 是其中可能使用的一种原子更新手段，两者不在同一抽象层。具体同步器解释 state 的含义，例如 ReentrantLock 用它记录持有与重入次数，Semaphore 用它表达可用许可。获取失败的线程由框架组织排队，并可通过 LockSupport 挂起，释放后再唤醒候选者重试。被唤醒不代表已经获得资源。AQS 支持独占和共享模式，也不是每次状态修改都必须 CAS；独占持有者重入或释放时，可能在已建立的独占条件下更新状态。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q05 ThreadLocal 为什么可能内存滞留，在线程池里如何使用？

ThreadLocal 让每个线程保存自己的变量值，值实际挂在该线程的 ThreadLocalMap 中；它不会自动复制对象，也不是跨线程身份传播方案。Map 的 Entry 对 ThreadLocal 键使用弱引用，对 value 仍持有强引用。键被回收后，value 不一定立即清除；线程池工作线程长期存活，任务结束却没有清理时，就可能保留大对象，或让下一任务读到旧身份。通常把设置和使用放入 try，并在 finally 中调用 `remove()`。跨线程执行应显式传递所需上下文；即使使用上下文传播工具，也要明确生命周期，不能假设请求线程中的值会自动出现在已有池化线程中。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q06 ThreadPoolExecutor 的七个参数和任务提交流程是什么？

七个参数是 corePoolSize、maximumPoolSize、keepAliveTime、unit、workQueue、threadFactory、handler，分别控制核心数量、最大数量、空闲存活、时间单位、等待队列、线程创建和拒绝处理。运行状态正常时，工作线程少于核心数通常先创建线程；达到核心数后先尝试入队；入队失败才尝试扩到最大数，仍无法接收则拒绝。入队后实现还会复查关闭状态及是否缺少工作线程。采用无界队列时，积压往往不会促使线程数扩到 maximumPoolSize，因此最大数不能代替队列容量管理。配置应同时考虑任务耗时、下游容量、排队时间和拒绝语义。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q07 线程池四种拒绝策略有什么区别，队列满了就一定拒绝吗？

队列满后若还可增加工作线程，线程池会先尝试扩容；池已关闭或已无法接收新任务时才进入拒绝处理。AbortPolicy 抛 RejectedExecutionException，让调用者明确感知失败；CallerRunsPolicy 在池未关闭时由提交线程执行，会把压力传回调用方，但池关闭时会丢弃。DiscardPolicy 静默丢弃新任务；DiscardOldestPolicy 在池未关闭时移除队列头，再尝试提交，队头不一定是时间上最早的任务。需要可靠交付的任务不适合静默丢弃。自定义策略可记录失败或写入可靠存储，但要限制重试，避免过载时无限循环。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q08 sleep、wait 与 interrupt 的区别是什么？

sleep 用于让当前线程休眠，不会释放已持有的锁；Object.wait 用于条件等待，调用前必须持有该对象的监视器，并且只释放这个监视器。收到通知后，等待线程仍要重新获得锁才能继续，所以条件检查应放在 while 中，处理虚假唤醒和条件再次变化。interrupt 是协作式取消信号，不会强行停止普通代码；sleep、wait 等操作可抛 InterruptedException 并清除中断标志。无法继续完成任务时应向上传递，或恢复标志后退出。`isInterrupted()` 只检查状态，`Thread.interrupted()` 检查当前线程并清除状态，不能混用。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q09 ConcurrentHashMap 线程安全，为什么 containsKey 后 put 仍有竞争？

以 JDK 8 为例，ConcurrentHashMap 用数组、链表和树组织数据，结合 CAS、局部同步与可见性机制处理读写，扩容时可由多个线程协作迁移；JDK 7 的主要机制则是 Segment 分段锁。单个操作安全不等于任意操作序列原子：两个线程都可能先判断键不存在，再各自 put。需要“没有才放入”时用 `putIfAbsent()`，同键计算可用 compute 或 merge。计算回调应短小，避免长时间远程调用；这些接口也不提供多键事务。它不接受 null 键或值，迭代是弱一致的，而且不会自动保护 value 内部可变字段的后续修改。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。

## Q10 死锁的必要条件有哪些，怎么排查和避免？

经典资源死锁需要同时满足互斥、持有并等待、不可剥夺、循环等待。两个线程按相反顺序获取两把锁，就是常见例子。排查时获取线程转储，查看线程等待的锁与持有者，串起等待关系；`jcmd <pid> Thread.print -l` 或 jstack 可辅助识别部分 Java 监视器和同步器死锁。避免时优先统一锁顺序、缩短持锁范围、减少嵌套，必要时使用带超时的 tryLock 并设计清理和重试。超时不会自动回滚已经完成的业务动作。线程池中任务占满工作线程后再等待同池子任务，也可能造成饥饿型停滞，不能只找两个 synchronized 互相等待。

来源：[小林coding：Java并发编程面试题](https://xiaolincoding.com/interview/juc.html)。
