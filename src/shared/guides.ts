/**
 * O que o painel de aula mostra para o diagrama aberto, venha de onde vier:
 *  - uma aula de DDD em TypeScript (`lessons.ts`): passos com trecho de código e a aula seguinte;
 *  - a aula de um exemplo (`example.lessons.ts`): passos sobre o diagrama do exemplo, que nos exemplos de Domínio podem
 *    estar em diagramas diferentes (o painel abre o diagrama do passo ao avançar).
 *
 * O diagrama é reconhecido pelo id (estável em todos os exemplos), então a aula aparece também num exemplo instalado antes.
 */
import { ARCH_EXAMPLES, archDocId } from "./arch.examples";
import { exampleLessonOf } from "./example.lessons";
import { DDD_EXAMPLES, exampleDocId, examplePath } from "./examples";
import { LESSONS, lessonOfDoc, type Lesson } from "./lessons";

export interface GuideStep {
  title: string;
  text: string;
  focus: string[];
  /** trecho de código (só nas aulas de DDD em TypeScript) */
  code?: { file: string; region: string };
  /** o diagrama do passo, quando a aula atravessa vários (exemplos de Domínio) */
  doc?: { id: string; path: string; title: string };
}

export interface Guide {
  /** único entre todas as aulas */
  key: string;
  /** a linha de cima do painel (ex.: «Aula 1 de 3 · DDD em TypeScript») */
  kicker: string;
  title: string;
  steps: GuideStep[];
  exercises: string[];
  /** a aula de DDD em TypeScript por trás do guia (código, aula seguinte) */
  course?: Lesson;
}

const cache = new Map<string, Guide | null>();

/** O guia do diagrama aberto, ou undefined se ele não tem aula. */
export function guideOfDoc(docId: string): Guide | undefined {
  if (!cache.has(docId)) cache.set(docId, build(docId) ?? null);
  return cache.get(docId) ?? undefined;
}

function build(docId: string): Guide | undefined {
  const course = lessonOfDoc({ id: docId });
  if (course)
    return { key: `aula:${course.id}`, kicker: `Aula ${course.n} de ${LESSONS.length} · DDD em TypeScript`, title: course.title, steps: course.steps, exercises: course.exercises, course };

  const arch = ARCH_EXAMPLES.find((a) => archDocId(a.id) === docId);
  if (arch) {
    const tour = exampleLessonOf(`architecture:${arch.id}`);
    return tour && { key: tour.example, kicker: "Aula do exemplo · Arquitetura", title: arch.title, steps: tour.steps, exercises: tour.exercises };
  }

  const ddd = DDD_EXAMPLES.find((ex) => ex.files.some((f) => exampleDocId(ex, f.file) === docId));
  if (ddd) {
    const tour = exampleLessonOf(`domain:${ddd.id}`);
    if (!tour) return undefined;
    const steps = tour.steps.map((s): GuideStep => {
      const f = ddd.files.find((x) => x.file === s.file) ?? ddd.files[0];
      return { title: s.title, text: s.text, focus: s.focus, doc: { id: exampleDocId(ddd, f.file), path: examplePath(ddd, f.file), title: f.title } };
    });
    return { key: tour.example, kicker: "Aula do exemplo · Domínio", title: ddd.title, steps, exercises: tour.exercises };
  }
  return undefined;
}

/** O primeiro passo que acontece no diagrama aberto (para quem entra num diagrama do exemplo pelo meio). */
export const firstStepIn = (g: Guide, docId: string) => Math.max(0, g.steps.findIndex((s) => !s.doc || s.doc.id === docId));
