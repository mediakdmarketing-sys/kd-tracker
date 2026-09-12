import ScreenshotGrid from '@/components/ScreenshotGrid';
import AudioPlayer from '@/components/AudioPlayer';
import { time, duration } from '@/lib/format';

/**
 * Screenshots grid + audio samples table — the one block that was duplicated near-verbatim
 * between the admin employee page and the leader member page. Both pages show the same two
 * capture types for the same reason (a supervisor reviewing one person's day); the only real
 * differences are which BFF path builds the file URL and whether the admin-only "Consent"
 * column is shown, both handled here via props rather than via two copies of the JSX.
 */
export default function CaptureSection({
  screenshots,
  audio,
  timezone,
  date,
  buildScreenshotUrl,
  buildAudioUrl,
  consentAudio,
  showConsentColumn = false,
  subjectLabel = 'employee',
}) {
  return (
    <>
      <ScreenshotGrid
        items={screenshots}
        timezone={timezone}
        date={date}
        buildFileUrl={buildScreenshotUrl}
      />

      <div className="card">
        <div className="card-head">
          <h2>Audio samples</h2>
          <span className="faint">
            {consentAudio ? 'Audio consent given' : 'Audio consent not given'}
          </span>
        </div>

        {audio.length === 0 ? (
          <div className="empty">
            {consentAudio
              ? 'No audio samples recorded on this date.'
              : `This ${subjectLabel} has not consented to audio sampling.`}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Length</th>
                  {showConsentColumn && <th>Consent</th>}
                  <th>Mic</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {audio.map((sample) => (
                  <tr key={sample.id}>
                    <td className="num">{time(sample.recordedAt, timezone)}</td>
                    <td className="num">{duration(sample.durationSeconds)}</td>
                    {showConsentColumn && (
                      <td>
                        {sample.consentVerified ? (
                          <span className="pill pill-working">Verified at capture</span>
                        ) : (
                          <span className="pill pill-flag">Missing</span>
                        )}
                      </td>
                    )}
                    <td>
                      {sample.micMuted === true ? (
                        <span
                          className="pill pill-flag"
                          title="No audio signal — mic was likely muted or disconnected"
                        >
                          Muted
                        </span>
                      ) : sample.micMuted === false ? (
                        <span className="pill pill-working">Live</span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>
                      {sample.fileDeleted ? (
                        <span className="faint">Deleted after 31 days</span>
                      ) : (
                        <AudioPlayer src={buildAudioUrl(sample)} style={{ height: 32 }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
