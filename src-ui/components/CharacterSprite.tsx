import { useEffect } from "react";
import { EMOTION_SET, type EmotionName } from "../lib/emotions";
import { useCharacter } from "../stores/character";
import styles from "./CharacterSprite.module.css";

interface CharacterSpriteProps {
  emotion: EmotionName;
  alt?: string;
}

export function CharacterSprite({
  emotion,
  alt = "character sprite",
}: CharacterSpriteProps) {
  const sprites = useCharacter((state) => state.sprites);
  const ready = useCharacter((state) => state.ready);
  const load = useCharacter((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const activeEmotion = sprites[emotion] ? emotion : "normal";
  const hasSprites = Object.keys(sprites).length > 0;

  if (ready && !hasSprites) {
    return <div className={styles.placeholder}>No Sprite</div>;
  }

  return (
    <div className={styles.container}>
      {EMOTION_SET.map((name) => {
        const src = sprites[name];
        if (!src) {
          return null;
        }

        return (
          <img
            key={name}
            src={src}
            alt={alt}
            className={`${styles.sprite} ${name === activeEmotion ? styles.active : ""}`}
            draggable={false}
          />
        );
      })}
    </div>
  );
}
