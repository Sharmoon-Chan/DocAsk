# Java 面试知识库：Redis 数据结构与持久化

整理日期：2026-11-11。本文根据小林 coding 公开资料编写，是原创复习总结，非官方原文。“高频”仅表示备考优先级，不是统计排行。主要比较 Redis 6.x、7.0，涉及 7.2 的变化会单独说明；数据类型、对象编码和具体数据结构是不同层次。

## Q01 Redis 常见数据类型如何选型？

String 适合缓存序列化对象、计数器等；Hash 适合按字段读取对象；List 表达有顺序的列表；Set 用于成员去重及交并差；Zset 适合带分值排序、排行榜和时间有序集合。选择应从操作方式出发，例如频繁只改一个字段，可比较 Hash 与整段对象重写的成本。

位图适合紧凑的二值状态，HyperLogLog 适合允许误差的去重计数，Stream 提供消息流与消费组等能力。不要把业务数据类型与底层编码混在一起，Hash 类型不保证任何大小都使用哈希表；List 也不是完整消息中间件。一次原子计数不等于“计数加下单”整体原子，多条命令和外部数据库操作仍需要单独设计并发与失败处理。

参考：[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)

## Q02 Redis String 为什么使用 SDS，int、embstr、raw 是什么？

SDS 记录字符串长度和分配空间，读取长度无需像传统零结尾字符串那样逐字节扫描，能够保存包含零字节的二进制数据；修改时会检查容量并按需要扩展，减少调用者管理缓冲区的负担。二进制安全不表示数据经过加密，保存令牌或个人资料仍需保护访问权限。

String 对象可能采用整数编码 `int`，短字符串可用把对象头与字符串紧邻分配的 `embstr`，较长或发生相应修改后使用 `raw`。这些编码是实现和内存取舍，并非三种业务数据类型；具体转换阈值要结合版本，用 `OBJECT ENCODING key` 观察。大字符串的复制、网络传输和持久化仍有成本，不能由常数时间取长度推导出所有字符串操作都很快。

参考：[Redis 数据结构](https://xiaolincoding.com/redis/data_struct/data_struct.html)、[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)

## Q03 Redis Hash 在 6.x、7.0 中有什么编码差异？

小 Hash 为节省指针和分配开销，会使用紧凑编码。Redis 6.x 常见的是 ziplist，Redis 7.0 改为 listpack；超过元素数量或字段、值长度等配置限制后，通常转换为哈希表。不能只看字段数量，还要看单个字段和值的长度，以及实例采用的实际配置。

哈希表便于按字段快速定位，紧凑编码则通过扫描换取小对象的内存节省。ziplist 的节点记录前一节点长度，特殊扩容可能引起后续长度字段连锁调整；listpack 改变了这种布局依赖，但插入大元素仍可能移动连续内存。排查时可结合 `HLEN`、`OBJECT ENCODING` 与内存占用，不能把 Hash 类型一律描述成平均常数时间的字典。

参考：[Redis 数据结构](https://xiaolincoding.com/redis/data_struct/data_struct.html)、[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)

## Q04 Redis List、quicklist、ziplist、listpack 是什么关系？

List 是业务上可从两端操作的列表类型，quicklist 则把多个紧凑容器用双向链表连接起来，兼顾两端操作与内存利用。Redis 6.x 的 quicklist 节点内部通常使用 ziplist；Redis 7.0 的普通 packed 节点改为 listpack，不能仍说新版本 List 就是单个压缩列表。

Redis 7.2 还允许小 List 直接采用 listpack，超过相关大小限制后转为 quicklist。紧凑容器并不支持任意位置都常数时间访问，`LRANGE` 大范围读取和中间位置查找仍可能昂贵。两端弹出能实现简单队列，但消费者拿到元素后崩溃会带来交付问题；若需要确认、重投递和消费组，需选择相应结构或补充协议。

参考：[Redis 数据结构](https://xiaolincoding.com/redis/data_struct/data_struct.html)、[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)

## Q05 Zset 为什么同时需要跳表和哈希表？

以 Redis 7.0 为例，大型 Zset 的跳表编码实际包含跳表与字典：跳表按分值、成员顺序组织记录，便于范围和排名操作；字典以成员查找分值，便于 `ZSCORE` 这类访问。两者服务不同的查询方向，不能说 Zset 只维护一张跳表。

小 Zset 可直接采用 listpack，成员与分值紧凑保存，不额外维护同样的字典；Redis 6.x 的小型编码通常还是 ziplist。跳表范围查询的成本还包括返回元素数量，`ZRANGE` 一次取走几十万元素仍可能拖慢实例。相同分值的成员也有确定的次序，但如果业务要按“最早达到此分数”排序，需要额外设计分值或排序规则，不能假定插入顺序会自动保留。

参考：[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)、[Redis 数据结构](https://xiaolincoding.com/redis/data_struct/data_struct.html)

## Q06 Redis 为什么快，它真的是完全单线程吗？

Redis 的常见优势来自内存访问、适合操作的数据结构、事件驱动的网络处理，以及多数命令在主线程串行执行而减少共享数据竞争。但进程并非只有一个线程：后台任务可处理刷盘、关闭文件和异步内存释放；生成快照、重写日志还会使用子进程。

Redis 6 起可以配置 I/O 线程分担部分网络读写工作，这不意味着普通键值命令已经在多个工作线程同时执行。串行执行只说明单条命令的相关操作不会被另一条普通命令插入，多次 `GET`、计算、`SET` 仍可能发生应用层竞争。大键、慢脚本、集中到期、磁盘压力和网络带宽都能造成延迟，不能用“全在内存”或“单线程”解释所有性能现象。

参考：[Redis 常见面试题](https://xiaolincoding.com/redis/base/redis_interview.html)

## Q07 RDB 的 SAVE、BGSAVE 和 fork 写时复制如何工作？

RDB 保存某个时间点的数据快照。`SAVE` 在主线程生成文件，会阻塞请求处理；`BGSAVE` 通过 fork 创建子进程写快照，父进程通常可继续服务。fork 初始共享物理页，父进程修改共享页时触发写时复制，子进程仍能读取原来的快照内容。

后台生成不等于完全没有阻塞：fork 复制页表需要时间，写时复制会增加内存和处理成本，磁盘竞争也可能影响业务。复制单位是内存页，不是“每写一个键就完整复制数据库”。故障时可能丢失最近成功快照之后的修改；如果连续快照失败，数据缺口还会扩大。应检查最近成功时间、子进程状态和额外内存，而不是只检查是否配置了定时保存。

参考：[RDB 快照是怎么实现的？](https://xiaolincoding.com/redis/storage/rdb.html)、[Redis 大 Key 对持久化有什么影响？](https://xiaolincoding.com/redis/storage/bigkey_aof_rdb.html)

## Q08 AOF 的 always、everysec、no 三种刷盘策略怎样取舍？

AOF 记录写操作用于恢复，命令进入 Redis 的日志缓冲后，`write` 通常只是把内容交给操作系统页缓存；只有按要求同步持久化，才能应对掉电等故障。`appendfsync always` 更强调每次相关写入的持久化，`everysec` 由后台周期同步，`no` 主要把同步时机交给操作系统。

三者在延迟和丢失风险之间取舍，不能把“写进文件”直接等同于“已落硬盘”。每秒策略常以约一秒数据风险作说明，但调度、磁盘阻塞和故障模式会影响窗口，不是所有异常下都严格最多一秒。后台 fsync 也不表示主线程永不受磁盘影响；写入大键或磁盘拥塞仍可能拖慢日志写入和后续请求。

参考：[AOF 持久化是怎么实现的？](https://xiaolincoding.com/redis/storage/aof.html)、[Redis 大 Key 对持久化有什么影响？](https://xiaolincoding.com/redis/storage/bigkey_aof_rdb.html)

## Q09 AOF 重写如何缩小日志，Redis 7 的 MP-AOF 有何变化？

AOF 重写依据当前内存数据生成恢复所需的表示，不是简单复制旧日志，也不是每个键一定只能用一条命令表示。多次覆盖写入的历史过程通常不必保留，因此可缩小文件并加快恢复。重写由子进程处理，期间的新写入还必须可靠记录，不能只保留 fork 时的快照。

Redis 7.0 引入多文件 AOF，通过基础文件、增量文件和清单管理恢复顺序；重写期间的新操作进入增量文件，成功后切换清单，避免沿用旧版本“最后一次合并整块重写缓冲区”的描述。基础文件可随配置采用 RDB 或 AOF 形式。fork 与写时复制成本依然存在，重写失败应保留可恢复的旧文件组合，不能把后台重写视为无成本压缩。

参考：[AOF 持久化是怎么实现的？](https://xiaolincoding.com/redis/storage/aof.html)

## Q10 RDB、AOF、混合持久化应如何选择？

RDB 适合紧凑快照、备份和较快加载，但数据恢复点受最近成功快照限制；AOF 可更频繁记录增量，恢复成本取决于日志规模和形式。混合持久化用快照表示基础数据，再重放增量，结合两者特点；Redis 7 的多文件实现应按清单及对应版本理解，不能一律套成单文件前后拼接。

选择依据是可接受的数据损失、恢复时间、写入压力、磁盘和内存预算。缓存数据若可从数据库重建，可接受不同的持久化取舍，但必须考虑重建期间的回源冲击；若 Redis 保存不可重建状态，更需要备份和恢复演练。主从复制不是历史备份，误删可能同步传播；同时开 RDB 和 AOF 也不意味着能免疫所有磁盘与人为故障。

参考：[RDB 快照是怎么实现的？](https://xiaolincoding.com/redis/storage/rdb.html)、[AOF 持久化是怎么实现的？](https://xiaolincoding.com/redis/storage/aof.html)
