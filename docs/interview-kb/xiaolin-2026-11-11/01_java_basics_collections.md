# Java 高频面试学习笔记：基础与集合

基于小林coding公开资料学习整理，非官方原文、非官方知识库。本文用独立表述归纳常见面试主题；“高频”表示复习优先级，不代表统计排名。整理日期：2026-11-11。涉及实现细节时以文中注明的 JDK 版本为准。

## Q01 equals 和 hashCode 为什么通常要一起重写？

`==` 比较引用时判断是否为同一对象；`equals()` 可以表达业务上的相等，例如两个用户对象具有相同用户编号。哈希集合先利用 `hashCode()` 定位候选桶，再在桶内确认对象相等。因此必须满足：两个对象相等，它们的哈希码也相等；反过来，相同哈希码不代表对象相等。只重写 equals，可能使两个相等对象进入不同桶，造成 HashSet 去重失败或 HashMap 查找失败。作为键参与相等判断的字段应保持稳定；入表后修改这些字段，即使对象引用没变，也可能再也查不到原条目。

来源：[小林coding：Java基础面试题](https://xiaolincoding.com/interview/java.html)。

## Q02 Java 方法传参是值传递还是引用传递？

Java 只有值传递，调用方法时会复制实参的值。基本类型复制数值，因此在方法里给参数重新赋值，不会改变调用者变量。对象类型复制的是引用值，两个引用仍可指向同一对象，所以方法能够修改这个对象的字段；但把参数赋成 `new User()`，只改变局部参数的指向，调用者原来的引用不变。判断例子时把“修改对象内容”和“替换引用变量”分开。比如给传入 List 执行 `add()` 会影响共享列表，执行 `list = new ArrayList<>()` 则不会替换调用者手中的列表。这也解释了 Java 方法不能靠交换两个形参引用来交换调用者变量。

来源：[小林coding：Java基础面试题](https://xiaolincoding.com/interview/java.html)。

## Q03 int 与 Integer 有什么区别，自动拆箱有哪些坑？

`int` 是基本类型，保存整数值；`Integer` 是包装对象，可用于泛型集合，也可以为 null。自动装箱通常调用 `Integer.valueOf()`，自动拆箱相当于调用 `intValue()`，因此对 null 拆箱会产生 NullPointerException。Integer 至少缓存 -128 到 127 范围的值，部分实现允许扩大缓存上界；引用之间用 `==` 比较会受到对象复用影响，不能用“某次比较恰好相等”推断数值比较规则。比较包装整数的数值可使用 equals，涉及可空对象时用 `Objects.equals()`；与基本类型混合比较时还要注意隐式拆箱。

来源：[小林coding：Java基础面试题](https://xiaolincoding.com/interview/java.html)。

## Q04 String 为什么不可变，StringBuilder 和 StringBuffer 怎么选？

String 创建后，其内容不能通过公开方法原地修改；拼接、替换等操作得到的是新的结果。不可变性来自受控的内部存储和接口设计，不只是类或字段写了 final。它便于字符串复用、缓存哈希值和安全共享。JDK 8 常见实现用 char 数组，JDK 9 起的紧凑字符串可使用 byte 数组和编码标记，不能把底层结构写死为 char[]。需要循环拼接时，单线程优先考虑 StringBuilder；StringBuffer 对主要操作提供同步，但多个方法组成的业务步骤仍可能需要额外协调。String 不可变也不代表保存 String 引用的变量不会被其他线程重新赋值。

来源：[小林coding：Java基础面试题](https://xiaolincoding.com/interview/java.html)。

## Q05 金额计算为什么使用 BigDecimal，而不是直接用 double？

double 用二进制浮点数表示数值，0.1 等十进制小数通常只能近似保存，连续计算可能积累误差。BigDecimal 用整数值和小数位数表达十进制数据，适合需要明确精度和舍入规则的金额计算。优先从字符串或准确的十进制输入构造；`new BigDecimal(0.1)` 会带入浮点近似值。除法遇到无限小数时必须按业务约定指定精度与 RoundingMode，否则可能抛 ArithmeticException。比较时 equals 同时考虑 scale，`1.0` 与 `1.00` 不相等；若只比较数值，使用 `compareTo() == 0`。BigDecimal 的运算返回新对象，需要接收返回值。

来源：[小林coding：Java基础面试题](https://xiaolincoding.com/interview/java.html)。

## Q06 ArrayList 和 LinkedList 的差别是什么，谁更适合中间插入？

ArrayList 用动态数组保存元素引用，按下标读取为 O(1)，尾部追加通常是均摊 O(1)，中间插入或删除需要搬移后续元素。LinkedList 是双向链表，头尾操作以及已经定位后的节点调整较快，但按下标操作必须先遍历，整体仍可能是 O(n)。因此“中间插入多就选 LinkedList”缺少定位成本这一前提。链表还有节点对象、前后引用和较差缓存局部性的开销，普通列表通常先选 ArrayList。两者都不提供并发修改保护；需要栈或双端队列时，还可评估不允许 null 的 ArrayDeque。

来源：[小林coding：Java集合面试题](https://xiaolincoding.com/interview/collections.html)。

## Q07 HashMap 的 put 和 get 大致经过哪些步骤？

以 JDK 8 的实现为例，HashMap 由数组和桶内的链表或红黑树组成。put 先计算扰动后的哈希，再用数组长度定位桶；空桶放入新节点，非空桶检查已有键，相等则覆盖值，不相等则继续查找或追加节点。新增节点后可能触发树化或扩容。get 使用同样的哈希定位，并通过键引用或 equals 确认目标。数组容量采用 2 的幂，便于用位运算定位和扩容拆分。HashMap 允许 null 键和 null 值，但不保证遍历顺序，也不保证线程安全；业务需要排序或插入顺序时，应选择相应的 Map 实现。

来源：[小林coding：Java集合面试题](https://xiaolincoding.com/interview/collections.html)。

## Q08 HashMap 什么时候扩容、什么时候链表转红黑树？

JDK 8 中，元素数量超过容量乘以负载因子形成的阈值时，通常会扩容为原来的两倍；默认负载因子是 0.75。迁移节点时根据新增的那一位哈希，把同一旧桶拆到原位置或“原位置加旧容量”，并保持组内次序。树化还要同时考虑桶长度和数组容量：普通 put 路径中，桶已有至少 8 个节点，再追加新节点时会尝试树化；数组长度小于 64 时优先扩容。`TREEIFY_THRESHOLD=8` 不能简单解释成所有写入方法都在第 8 个节点立即转树。扩容分裂树桶时，较小分组可按阈值退回链表，删除路径还涉及树结构判断。

来源：[小林coding：Java集合面试题](https://xiaolincoding.com/interview/collections.html)。

## Q09 遍历 List 时能删除元素吗，fail-fast 能保证线程安全吗？

普通 ArrayList 的增强 for 基于迭代器；在循环中绕过迭代器直接增删集合结构，可能触发 ConcurrentModificationException。需要遍历删除时，可用支持删除的 `Iterator.remove()`，或直接使用 `removeIf()`；普通下标循环删除还要避免元素前移后被跳过。fail-fast 通过结构修改计数发现部分非法修改，只是尽力检测，单线程也能触发，不能充当并发安全机制。CopyOnWriteArrayList 的迭代器读取创建时快照，不反映后来更新，也不支持迭代器删除；ConcurrentHashMap 的遍历是弱一致性，不能当作全表某一时刻的快照。

来源：[小林coding：Java集合面试题](https://xiaolincoding.com/interview/collections.html)。

## Q10 HashSet、LinkedHashSet 和 TreeSet 怎样判断重复与顺序？

三者都用于保存不重复元素，但去重与排序规则不同。HashSet 基于 HashMap，使用 hashCode 与 equals 判重，不保证迭代顺序；LinkedHashSet 在哈希结构上维护插入顺序，适合既去重又保留输入次序。TreeSet 基于有序树结构，按照自然顺序或 Comparator 排列，比较结果为 0 时视为同一元素。因此比较器应与希望表达的相等规则一致，否则可能把业务上不同的对象合并。HashSet 和 LinkedHashSet 可容纳一个 null，TreeSet 是否接受 null 取决于比较器，不能一概推广。需要并发写入时还应另选并发集合或统一同步。

来源：[小林coding：Java集合面试题](https://xiaolincoding.com/interview/collections.html)。
