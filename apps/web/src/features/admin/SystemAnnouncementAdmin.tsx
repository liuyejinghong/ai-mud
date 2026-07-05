import { useState } from "react";
import { publishSystemAnnouncement } from "./adminApi";

export function SystemAnnouncementAdmin({ csrfToken }: { csrfToken: string }) {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  async function onPublish() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsPublishing(true);
    setMessage("");
    try {
      await publishSystemAnnouncement(trimmed, csrfToken);
      setBody("");
      setMessage("公告已发布");
    } catch {
      setMessage("公告发布失败");
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="system-announcement-admin-title">
      <div className="admin-panel-header">
        <h2 id="system-announcement-admin-title">系统公告</h2>
        <span>Broadcast</span>
      </div>

      <div className="admin-panel-body">
        <label className="admin-field" htmlFor="system-announcement-body">
          公告内容
          <textarea
            id="system-announcement-body"
            value={body}
            maxLength={240}
            rows={4}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={isPublishing || !body.trim()}
          onClick={() => void onPublish()}
        >
          发布到大厅
        </button>

        <p role="status" aria-live="polite" className="admin-status">
          {message}
        </p>
      </div>
    </section>
  );
}
