import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  Typography,
  Button,
  Upload,
  Table,
  Popconfirm,
  Space,
  Empty,
  Spin,
  Tag,
  Modal,
  Alert,
  Tooltip,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BookOutlined,
  UploadOutlined,
  DeleteOutlined,
  FileOutlined,
  EyeOutlined,
  MessageOutlined,
  LockOutlined,
  GlobalOutlined,
  LoadingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type { TableColumnsType, UploadProps } from "antd";
import { useKnowledgeBases } from "../../hooks/useKnowledgeBases.ts";
import { useDocuments } from "../../hooks/useDocuments.ts";
import { uploadDocument } from "../../api/api.ts";
import {
  describeIngestionStatus,
  ingestionProgressText,
  type DocumentWithIngestion,
} from "../../types/ingestion.ts";
import { IS_PUBLIC_DEMO } from "../../config.ts";
import DocumentPreviewDrawer from "../modals/DocumentPreviewDrawer.tsx";
import { showRequestError } from "../../api/http.ts";
import { notify } from "../../api/feedback.ts";

const { Title, Text, Paragraph } = Typography;
const isMarkdown = (filename: string) => /\.(?:md|markdown)$/i.test(filename);

const KnowledgeBaseContent: React.FC<{ knowledgeBaseId?: string }> = ({ knowledgeBaseId }) => {
  const navigate = useNavigate();
  const { knowledgeBases, loading: loadingKnowledgeBases, deleteKnowledgeBaseHandle } = useKnowledgeBases();
  const { documents, loading, refreshDocuments, deleteDocument, retryIngestion } =
    useDocuments(knowledgeBaseId);

  const [uploading, setUploading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentWithIngestion | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const currentKnowledgeBase = useMemo(() => {
    if (!knowledgeBaseId) return null;
    return (
      knowledgeBases.find((kb) => kb.knowledgeBaseId === knowledgeBaseId) ||
      null
    );
  }, [knowledgeBaseId, knowledgeBases]);
  const readOnly = IS_PUBLIC_DEMO || !currentKnowledgeBase || currentKnowledgeBase.readOnly === true;
  const isPublic = IS_PUBLIC_DEMO || currentKnowledgeBase?.publicResource === true;

  const handleDeleteKnowledgeBase = async () => {
    if (!knowledgeBaseId || readOnly || deleting) return;
    setDeleting(true);
    try {
      await deleteKnowledgeBaseHandle(knowledgeBaseId);
      setPreviewDocument(null);
      notify.success("知识库已删除");
      navigate("/knowledge-base", { replace: true });
    } catch (error) {
      showRequestError(error, "删除知识库失败，请重试");
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload: UploadProps["customRequest"] = async (options) => {
    const { file, onSuccess, onError } = options;

    if (!knowledgeBaseId || readOnly) {
      notify.error("请先选择知识库");
      return;
    }

    setUploading(true);

    try {
      await uploadDocument(knowledgeBaseId, file as File);
      notify.success("文档已受理，正在后台索引");
      await refreshDocuments();
      onSuccess?.(file);
    } catch (error) {
      showRequestError(error, "上传失败");
      onError?.(error as Error);
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async (documentId: string) => {
    if (retrying) return;
    setRetrying(documentId);
    try {
      await retryIngestion(documentId);
      notify.success("已重新加入导入队列");
    } catch (error) {
      showRequestError(error, "重试失败，请稍后重试");
    } finally {
      setRetrying(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const columns: TableColumnsType<DocumentWithIngestion> = [
    {
      title: "文件名",
      dataIndex: "filename",
      key: "filename",
      width: 260,
      render: (text: string, record: DocumentWithIngestion) => (
        <div className="flex min-w-0 items-start gap-2">
          <FileOutlined className="mt-1 shrink-0 text-accent" />
          {isMarkdown(text) ? (
            <button
              type="button"
              className="min-w-0 cursor-pointer break-all text-left font-medium text-accent hover:underline"
              aria-label={`预览 ${text}`}
              onClick={() => setPreviewDocument(record)}
            >
              {text}
            </button>
          ) : (
            <span className="min-w-0 break-all text-ink">{text}</span>
          )}
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "filetype",
      key: "filetype",
      width: 96,
      responsive: ["lg"],
      render: (value: string) => <span className="font-mono text-xs text-slate-500">{value}</span>,
    },
    {
      title: "大小",
      dataIndex: "size",
      key: "size",
      width: 100,
      responsive: ["lg"],
      render: (size: number) => <span className="font-mono text-xs text-slate-500">{formatFileSize(size)}</span>,
    },
    {
      title: "操作",
      key: "action",
      width: readOnly ? 88 : 160,
      render: (_: unknown, record: DocumentWithIngestion) => (
        <Space size={0} wrap>
          <Button
            type="link"
            icon={<EyeOutlined />}
            size="small"
            disabled={!isMarkdown(record.filename)}
            onClick={() => setPreviewDocument(record)}
          >
            预览
          </Button>
          {!readOnly && !record.readOnly && (
            <Popconfirm
              title="确定要删除这个文档吗？"
              description="删除后将无法恢复"
              onConfirm={() => deleteDocument(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="text" danger icon={<DeleteOutlined />} size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
    {
      title: "索引状态",
      key: "ingestion",
      width: 210,
      render: (_: unknown, record: DocumentWithIngestion) => {
        const stage = describeIngestionStatus(record.indexStatus);
        if (!stage) {
          return <Text type="secondary" className="text-xs">未索引</Text>;
        }
        const retryable =
          !readOnly && !record.readOnly && stage.retryable && Boolean(record.jobId);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1">
              <Tag color={stage.color} icon={stage.active ? <LoadingOutlined /> : undefined}>
                {stage.label}
              </Tag>
              {retryable && (
                <Button
                  type="link"
                  size="small"
                  icon={<SyncOutlined />}
                  loading={retrying === record.id}
                  onClick={() => void handleRetry(record.id)}
                >
                  重试
                </Button>
              )}
            </div>
            <Tooltip title={ingestionProgressText(record)}>
              <Text
                type={stage.label === "处理失败" ? "danger" : "secondary"}
                className="max-w-full truncate text-xs"
              >
                {ingestionProgressText(record)}
              </Text>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  if (loadingKnowledgeBases) {
    return <div className="flex h-full items-center justify-center bg-paper"><Spin /></div>;
  }

  if (IS_PUBLIC_DEMO && !knowledgeBaseId) {
    return (
      <div className="h-full overflow-y-auto bg-paper p-5 sm:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="border-b border-slate-200 pb-5">
            <Title level={2} className="mb-2! tracking-tight text-ink!">
              公开知识库
            </Title>
            <Paragraph className="mb-0! max-w-2xl text-sm leading-6 text-ink-soft">
              浏览当前挂载的公开项目资料与技术整理，可直接阅读 Markdown 原文与源码，或在体验台发起引用检索问答。
            </Paragraph>
          </div>

          {knowledgeBases.length === 0 ? (
            <div className="py-16"><Empty description="公开知识库准备中" /></div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {knowledgeBases.map((knowledgeBase) => (
                <div
                  key={knowledgeBase.knowledgeBaseId}
                  className="arch-card arch-card-interactive flex flex-col justify-between p-5"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg text-slate-600">
                      <BookOutlined />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Title level={4} className="mt-0! mb-1.5! text-[15px]! font-semibold! text-ink!">
                        {knowledgeBase.name}
                      </Title>
                      <Paragraph className="mb-0! text-xs leading-5 text-ink-soft">
                        {knowledgeBase.description}
                      </Paragraph>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-400">只读公开资料</span>
                    <Button
                      size="small"
                      onClick={() => navigate(`/knowledge-base/${knowledgeBase.knowledgeBaseId}`)}
                    >
                      查看文档列表 <ArrowRightOutlined />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!knowledgeBaseId) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-paper p-6">
        <Empty
          image={<BookOutlined className="text-5xl text-slate-300" />}
          description={
            <div className="mt-4">
              <Title level={4} type="secondary">未选择知识库</Title>
              <Text type="secondary" className="text-sm">
                请从左侧工作区侧栏选择一个知识库查看详情
              </Text>
            </div>
          }
        />
      </div>
    );
  }

  if (!currentKnowledgeBase) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-paper p-6">
        <Empty
          description={
            <div className="mt-4">
              <Title level={4} type="secondary">知识库不存在</Title>
              <Text type="secondary" className="text-sm">
                该知识库已删除，或不属于当前账号。
              </Text>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-paper p-5 sm:p-8">
      <div className="mx-auto w-full max-w-5xl min-w-0">
        {IS_PUBLIC_DEMO && (
          <div className="mb-3">
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/knowledge-base")}
            >
              返回公开知识库列表
            </Button>
          </div>
        )}

        <div className="arch-card mb-4 p-5">
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-4 sm:flex sm:flex-wrap">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xl text-slate-600 sm:h-12 sm:w-12">
              <BookOutlined />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {isPublic ? <GlobalOutlined /> : <LockOutlined />}
                  {isPublic ? "公开演示库" : "私有 · 仅当前账号可见"}
                </span>
              </div>
              <Title level={3} className="mb-1! break-words text-ink!">
                {currentKnowledgeBase.name}
              </Title>
              {currentKnowledgeBase.description && (
                <Paragraph className="mb-0! break-words text-sm leading-6 text-ink-soft">
                  {currentKnowledgeBase.description}
                </Paragraph>
              )}
            </div>
            {!readOnly && (
              <Button
                className="col-span-2 justify-self-start sm:shrink-0"
                danger
                icon={<DeleteOutlined />}
                disabled={uploading || deleting}
                onClick={() => setDeleteOpen(true)}
              >
                删除知识库
              </Button>
            )}
          </div>
        </div>

        {readOnly && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-card">
            <span className="flex-1 text-sm leading-6 text-ink-soft">
              点击任意 Markdown 文件名阅读原文与源码，或直接使用此知识库提问。
            </span>
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => navigate("/chat", {
                state: { suggestedPrompt: `请检索公开知识库「${currentKnowledgeBase.name}」，介绍问档 DocAsk 的技术架构与检索流程，并注明文档来源。` },
              })}
            >
              用这个知识库提问
            </Button>
          </div>
        )}

        {!readOnly && (
          <div className="mb-4">
            <Card title="上传文档">
              {isPublic && (
                <Alert
                  className="mb-4!"
                  type="warning"
                  showIcon
                  title="此库用于公开演示，上传的文档对所有访客可见。"
                />
              )}
              <Upload
                customRequest={handleUpload}
                showUploadList={false}
                accept=".md,.markdown"
                disabled={uploading || deleting}
              >
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  loading={uploading}
                  size="large"
                >
                  选择文件上传
                </Button>
              </Upload>
              <Text type="secondary" className="mt-2 block text-xs">
                支持格式: UTF-8 Markdown（.md / .markdown，最大 2 MiB）
              </Text>
            </Card>
          </div>
        )}

        <div className="mb-4">
          <Card title={`文档列表 (${documents.length})`}>
            {loading ? (
              <div className="py-8 text-center">
                <Text type="secondary">加载中…</Text>
              </div>
            ) : documents.length === 0 ? (
              <Empty
                description={<Text type="secondary">{readOnly ? "暂无公开文档" : "暂无文档，请上传文档"}</Text>}
              />
            ) : (
              <Table
                columns={columns}
                dataSource={documents}
                rowKey="id"
                tableLayout="fixed"
                scroll={{ x: 600 }}
                pagination={{
                  pageSize: 10,
                  showTotal: (total) => `共 ${total} 条`,
                }}
              />
            )}
          </Card>
        </div>
      </div>

      {previewDocument && (
        <DocumentPreviewDrawer
          key={previewDocument.id}
          document={previewDocument}
          onClose={() => setPreviewDocument(null)}
        />
      )}

      <Modal
        title="删除知识库"
        open={deleteOpen}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        closable={!deleting}
        maskClosable={!deleting}
        onCancel={() => { if (!deleting) setDeleteOpen(false); }}
        onOk={() => { void handleDeleteKnowledgeBase(); }}
      >
        <Paragraph>确定删除「{currentKnowledgeBase.name}」及其中的全部文档和检索索引？</Paragraph>
        <Paragraph type="secondary">
          助手将解除对此知识库的关联。已保存的聊天记录会保留，此操作无法在页面中撤销。
        </Paragraph>
        {isPublic && (
          <Alert type="warning" showIcon title="删除后，所有访客都将无法访问此公开演示库。" />
        )}
      </Modal>
    </div>
  );
};

const KnowledgeBaseView: React.FC = () => {
  const { knowledgeBaseId } = useParams<{ knowledgeBaseId?: string }>();
  return <KnowledgeBaseContent key={knowledgeBaseId ?? "index"} knowledgeBaseId={knowledgeBaseId} />;
};

export default KnowledgeBaseView;
