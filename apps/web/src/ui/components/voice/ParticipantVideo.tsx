import React, { useEffect, useRef } from "react";
import { Track, type LocalParticipant, type Participant } from "livekit-client";

interface ParticipantVideoProps {
    participant: Participant | LocalParticipant;
    /** Your own camera shows mirrored, the way a mirror would. */
    mirrored: boolean;
    /** Changes whenever a camera track comes, goes or is muted, so the current one is attached. */
    revision: number;
}

/**
 * A participant's camera. The room streams with adaptiveStream on, so only the size
 * this element is shown at is fetched, and nothing while it is out of view.
 */
export function ParticipantVideo({ participant, mirrored, revision }: ParticipantVideoProps): React.ReactElement {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const element = videoRef.current;
        const track = participant.getTrackPublication(Track.Source.Camera)?.track;
        if (!element || !track) {
            return undefined;
        }
        track.attach(element);
        return () => {
            track.detach(element);
        };
    }, [participant, revision]);

    return (
        <video
            ref={videoRef}
            className={`voice-room-participant-video${mirrored ? " is-mirrored" : ""}`}
            autoPlay
            playsInline
            muted
        />
    );
}
