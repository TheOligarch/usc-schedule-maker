/**
 * Hand-written sample term matching the TermData contract. Used on the dev page and as a
 * fallback while the real per-term file is not published yet. Course codes and titles are
 * USC-shaped, but every instructor name, rating, seat count and meeting time is invented.
 */
import type { Course, Day, Instructor, RmpTeacher, Section, SectionType, TermData } from "../lib/contract-types";

const TERM_CODE = "20271";

interface SecSpec {
  type: SectionType;
  link: string | null;
  days: string; // "MW", "TTh", "F", "" = TBA
  start: string;
  end: string;
  instructor: string | null;
  total: number;
  registered: number;
  dClearance?: boolean;
  online?: boolean;
  final?: [string, string, string];
  notes?: string;
  alsoListedAs?: string[];
}

interface CourseSpec {
  code: string;
  title: string;
  units: number | [number, number];
  description: string;
  ge?: string[];
  prereq?: string;
  linkage?: Course["linkage"];
  crossListedWith?: string[];
  sections: SecSpec[];
}

/** name -> [avg, difficulty, count, wouldTakeAgain, department, match] */
const RATINGS: Record<string, [number, number, number, number | null, string, "exact" | "initial"]> = {
  "Elena Marchetti": [4.6, 3.1, 212, 91, "Computer Science", "exact"],
  "Victor Okonkwo": [3.2, 4.2, 148, 54, "Computer Science", "exact"],
  "Priya Raghunathan": [4.8, 2.9, 96, 97, "Computer Science", "exact"],
  "Daniel Whitcombe": [2.6, 4.5, 187, 38, "Computer Science", "exact"],
  "Hannah Lindqvist": [4.1, 3.4, 64, 82, "Computer Science", "exact"],
  "Marcus Delacroix": [3.9, 3.6, 41, 76, "Computer Science", "initial"],
  "Sofia Benedetti": [4.4, 3.0, 133, 88, "Mathematics", "exact"],
  "Gregory Thanh": [3.0, 4.1, 201, 49, "Mathematics", "exact"],
  "Amara Nwosu": [4.7, 2.7, 58, 95, "Mathematics", "exact"],
  "Leon Fairweather": [3.6, 3.8, 77, 68, "Electrical Engineering", "exact"],
  "Ingrid Solberg": [4.3, 2.4, 119, 90, "Writing", "exact"],
  "Tobias Reinholt": [3.8, 2.8, 86, 79, "Writing", "exact"],
  "Camille Durand": [4.9, 2.1, 302, 98, "Cinematic Arts", "exact"],
  "Rafael Montoya": [4.2, 2.3, 74, 87, "Music", "exact"],
  "Beatrix Hollowell": [4.5, 2.6, 51, 92, "Theatre", "initial"],
  "Julian Ashworth": [3.4, 3.5, 166, 61, "Philosophy", "exact"],
  "Naomi Castellanos": [4.6, 2.8, 143, 93, "English", "exact"],
  "Desmond Achebe": [4.0, 3.0, 39, 80, "Classics", "exact"],
  "Yuki Tanabe": [4.4, 2.5, 388, 89, "Psychology", "exact"],
  "Fiona Gallagher-Reyes": [3.7, 3.2, 92, 72, "Sociology", "exact"],
  "Anton Vasquez": [4.1, 3.3, 67, 84, "International Relations", "exact"],
  "Meredith Okafor": [4.3, 2.9, 110, 86, "Biological Sciences", "exact"],
  "Stellan Bergstrom": [4.7, 2.2, 254, 96, "Astronomy", "exact"],
  "Rosalind Pemberton": [3.5, 3.1, 45, 66, "Earth Sciences", "exact"],
  "Kwame Adjei": [4.2, 3.4, 88, 85, "Linguistics", "exact"],
  "Lucia Fontaine": [4.8, 2.4, 171, 97, "American Studies", "exact"],
  "Henrik Vandermeer": [3.3, 3.7, 59, 58, "History", "exact"],
  "Isadora Quint": [4.5, 2.6, 36, 91, "Religion", "initial"],
  "Oscar Valdivia": [4.0, 3.2, 128, 81, "Information Technology", "exact"],
  "Thea Rosenquist": [4.6, 2.7, 83, 94, "Interactive Media", "exact"],
  "Bartholomew Nkemelu": [2.9, 4.0, 72, 44, "Economics", "exact"],
  "Wendeline Hartigan": [4.1, 3.5, 54, 83, "Business", "exact"],
  "Cassius Abernathy": [3.8, 3.9, 97, 74, "Physics", "exact"],
};

// Finals: [date, start, end]. A few lectures share a slot so final-exam conflicts show up.
const F = {
  wed8: ["2027-05-05", "08:00", "10:00"],
  wed11: ["2027-05-05", "11:00", "13:00"],
  wed2: ["2027-05-05", "14:00", "16:00"],
  thu8: ["2027-05-06", "08:00", "10:00"],
  thu11: ["2027-05-06", "11:00", "13:00"],
  thu2: ["2027-05-06", "14:00", "16:00"],
  fri8: ["2027-05-07", "08:00", "10:00"],
  fri11: ["2027-05-07", "11:00", "13:00"],
  mon11: ["2027-05-10", "11:00", "13:00"],
  mon2: ["2027-05-10", "14:00", "16:00"],
  tue8: ["2027-05-11", "08:00", "10:00"],
  tue2: ["2027-05-11", "14:00", "16:00"],
} satisfies Record<string, [string, string, string]>;

function s(
  type: SectionType,
  link: string | null,
  days: string,
  start: string,
  end: string,
  instructor: string | null,
  total: number,
  registered: number,
  extra: Partial<SecSpec> = {},
): SecSpec {
  return { type, link, days, start, end, instructor, total, registered, ...extra };
}

const COURSES: CourseSpec[] = [
  {
    code: "CSCI-104",
    title: "Data Structures and Object Oriented Design",
    units: 4,
    description:
      "Introduces the student to standard data structures (linear structures such as linked lists, (balanced) trees, priority queues, and hashtables), using the C++ programming language.",
    prereq: "PRE-REQUISITES: 1 from (CSCI-103 or CSCI-102) and CSCI-170",
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "09:30", "10:50", "Elena Marchetti", 150, 121, { final: F.thu8 }),
      s("LAB", "A", "W", "10:00", "11:50", null, 40, 33),
      s("LAB", "A", "W", "14:00", "15:50", null, 40, 40),
      s("LAB", "A", "F", "10:00", "11:50", null, 40, 22),
      s("LEC", "B", "MW", "14:00", "15:20", "Daniel Whitcombe", 150, 64, { final: F.wed2 }),
      s("LAB", "B", "Th", "16:00", "17:50", null, 40, 18),
      s("LAB", "B", "F", "12:00", "13:50", null, 40, 9),
    ],
  },
  {
    code: "CSCI-170",
    title: "Discrete Methods in Computer Science",
    units: 4,
    description:
      "Sets, functions, series. Big-O notation and algorithm analysis. Propositional and first-order logic. Counting and discrete probability. Graphs and basic graph algorithms.",
    prereq: "PRE-REQUISITES: 1 from (CSCI-102 or CSCI-103)",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "10:00", "11:20", "Priya Raghunathan", 160, 152, { final: F.wed11 }),
      s("DIS", "A", "F", "09:00", "09:50", null, 55, 54),
      s("DIS", "A", "F", "11:00", "11:50", null, 55, 49),
      s("DIS", "A", "Th", "17:00", "17:50", null, 55, 31),
      s("LEC", "B", "TTh", "15:30", "16:50", "Victor Okonkwo", 160, 71, { final: F.thu2 }),
      s("DIS", "B", "F", "13:00", "13:50", null, 80, 30),
      s("DIS", "B", "W", "17:00", "17:50", null, 80, 28),
    ],
  },
  {
    code: "CSCI-201",
    title: "Principles of Software Development",
    units: 4,
    description:
      "Object-Oriented Programming in Java; using Java threads, Web Services and SQL to write client/server applications; team project.",
    prereq: "PRE-REQUISITES: 1 from (CSCI-104 or CSCI-114)",
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "11:00", "12:20", "Hannah Lindqvist", 180, 98, { final: F.thu11 }),
      s("LAB", "A", "M", "10:00", "11:50", null, 30, 20),
      s("LAB", "A", "M", "14:00", "15:50", null, 30, 8),
      s("LAB", "A", "W", "16:00", "17:50", null, 30, 30),
      s("LEC", "B", "MW", "08:30", "09:50", "Victor Okonkwo", 120, 37, { final: F.wed8 }),
      s("LAB", "B", "F", "10:00", "11:50", null, 30, 12),
      s("LAB", "B", "Th", "18:00", "19:50", null, 30, 5),
    ],
  },
  {
    code: "CSCI-270",
    title: "Introduction to Algorithms and Theory of Computing",
    units: 4,
    description:
      "Algorithm analysis and design: greedy algorithms, divide and conquer, dynamic programming, network flow. NP-completeness and undecidability.",
    prereq: "PRE-REQUISITES: CSCI-104 and CSCI-170",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "12:00", "13:20", "Priya Raghunathan", 140, 140, { dClearance: true, final: F.mon11 }),
      s("DIS", "A", "F", "14:00", "14:50", null, 70, 70, { dClearance: true }),
      s("LEC", "B", "TTh", "14:00", "15:20", "Marcus Delacroix", 140, 88, { dClearance: true, final: F.tue2 }),
      s("DIS", "B", "F", "10:00", "10:50", null, 70, 44, { dClearance: true }),
      s("DIS", "B", "F", "15:00", "15:50", null, 70, 44, { dClearance: true }),
    ],
  },
  {
    code: "CSCI-360",
    title: "Introduction to Artificial Intelligence",
    units: 4,
    description:
      "Concepts and algorithms underlying the understanding and construction of intelligent systems. Agents, problem solving, search, representation, reasoning, planning, machine learning.",
    prereq: "PRE-REQUISITES: CSCI-104 and CSCI-170",
    linkage: "ambiguous",
    sections: [
      s("LEC", null, "MW", "16:00", "17:20", "Elena Marchetti", 110, 77, { final: F.mon2 }),
      s("DIS", null, "F", "12:00", "12:50", null, 55, 40),
      s("DIS", null, "Th", "12:30", "13:20", null, 55, 37),
      s("LEC", null, "TTh", "09:30", "10:50", "Daniel Whitcombe", 110, 52, { final: F.thu8 }),
      s("DIS", null, "W", "09:00", "09:50", null, 55, 25),
      s("DIS", null, "F", "16:00", "16:50", null, 55, 27),
    ],
  },
  {
    code: "CSCI-467",
    title: "Introduction to Machine Learning",
    units: 4,
    description:
      "Statistical methods for building intelligent and adaptive systems that improve performance from experience. Supervised and unsupervised learning.",
    prereq: "PRE-REQUISITES: CSCI-270 and MATH-225 and (EE-364 or MATH-407)",
    linkage: "single",
    crossListedWith: ["EE-467"],
    sections: [
      s("LEC", null, "TTh", "17:00", "18:20", "Marcus Delacroix", 90, 86, { final: F.tue8, alsoListedAs: ["EE-467"] }),
      s("DIS", null, "F", "13:00", "13:50", null, 45, 44, { alsoListedAs: ["EE-467"] }),
      s("DIS", null, "W", "18:00", "18:50", null, 45, 42, { alsoListedAs: ["EE-467"] }),
    ],
  },
  {
    code: "MATH-225",
    title: "Linear Algebra and Linear Differential Equations",
    units: 4,
    description:
      "Matrices, systems of linear equations, vector spaces, linear transformations, eigenvalues, systems of linear differential equations.",
    prereq: "PRE-REQUISITES: 1 from (MATH-126 or MATH-127 or MATH-129)",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MWF", "09:00", "09:50", "Sofia Benedetti", 120, 109, { final: F.fri8 }),
      s("DIS", "A", "TTh", "08:00", "08:50", null, 40, 38),
      s("DIS", "A", "TTh", "13:00", "13:50", null, 40, 40),
      s("DIS", "A", "TTh", "16:00", "16:50", null, 40, 31),
      s("LEC", "B", "MWF", "13:00", "13:50", "Gregory Thanh", 120, 58, { final: F.wed2 }),
      s("DIS", "B", "TTh", "10:00", "10:50", null, 60, 30),
      s("DIS", "B", "TTh", "14:00", "14:50", null, 60, 28),
      s("LEC", "C", "MWF", "11:00", "11:50", "Amara Nwosu", 120, 117, { final: F.fri11 }),
      s("DIS", "C", "TTh", "09:00", "09:50", null, 60, 59),
      s("DIS", "C", "TTh", "12:00", "12:50", null, 60, 58),
    ],
  },
  {
    code: "MATH-407",
    title: "Probability Theory",
    units: 4,
    description:
      "Probability spaces, discrete and continuous distributions, moments, characteristic functions, sequences of random variables, laws of large numbers, central limit theorem.",
    prereq: "PRE-REQUISITES: MATH-226 or MATH-227",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MWF", "10:00", "10:50", "Amara Nwosu", 80, 61, { final: F.wed11 }),
      s("DIS", "A", "T", "15:00", "15:50", null, 40, 30),
      s("DIS", "A", "Th", "09:00", "09:50", null, 40, 31),
      s("LEC", "B", "TTh", "12:30", "13:50", "Gregory Thanh", 80, 34, { final: F.thu11 }),
      s("DIS", "B", "W", "15:00", "15:50", null, 40, 17),
      s("DIS", "B", "F", "09:00", "09:50", null, 40, 17),
    ],
  },
  {
    code: "EE-109",
    title: "Introduction to Embedded Systems",
    units: 4,
    description:
      "Information representations, embedded programming in C, digital and serial I/O, analog-to-digital conversion, and interrupt mechanisms. Laboratory projects on a microcontroller.",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "12:30", "13:50", "Leon Fairweather", 100, 73, { final: F.mon11 }),
      s("LAB", "A", "T", "12:30", "13:50", null, 25, 25),
      s("LAB", "A", "Th", "15:30", "16:50", null, 25, 19),
      s("LAB", "A", "F", "11:00", "12:20", null, 25, 14),
    ],
  },
  {
    code: "PHYS-151",
    title: "Fundamentals of Physics I: Mechanics and Thermodynamics",
    units: 4,
    description:
      "Statics and dynamics of particles and rigid bodies, conservation principles, gravitation, simple harmonic oscillators, thermodynamics, heat engines, entropy.",
    ge: ["E"],
    prereq: "PRE-REQUISITES: 1 from (MATH-125 or MATH-126 or MATH-226)",
    linkage: "coded",
    sections: [
      s("LEC", "A", "MWF", "11:00", "11:50", "Cassius Abernathy", 220, 164, { final: F.fri11 }),
      s("LAB", "A", "T", "14:00", "16:50", null, 24, 20),
      s("LAB", "A", "Th", "08:00", "10:50", null, 24, 11),
      s("QZ", "A", "Th", "19:00", "20:20", null, 220, 164),
    ],
  },
  {
    code: "WRIT-340",
    title: "Advanced Writing",
    units: [3, 4],
    description:
      "Instruction in writing for various audiences on topics related to a student's professional or disciplinary interests, with some emphasis on issues of broad public concern.",
    prereq: "PRE-REQUISITES: WRIT-150 or WRIT-130",
    linkage: "single",
    sections: [
      s("LEC", null, "MW", "10:00", "11:20", "Ingrid Solberg", 19, 19, { final: F.wed11 }),
      s("LEC", null, "MW", "14:00", "15:20", "Ingrid Solberg", 19, 16, { final: F.wed2 }),
      s("LEC", null, "TTh", "08:00", "09:20", "Tobias Reinholt", 19, 7, { final: F.tue8 }),
      s("LEC", null, "TTh", "12:30", "13:50", "Tobias Reinholt", 19, 15, { final: F.thu11 }),
      s("LEC", null, "TTh", "17:00", "18:20", null, 19, 4, { final: F.tue2 }),
      s("LEC", null, "", "", "", "Ingrid Solberg", 19, 6, { online: true, notes: "Online section. Meets asynchronously." }),
    ],
  },
  {
    code: "BUAD-304",
    title: "Organizational Behavior and Leadership",
    units: 4,
    description:
      "The role of the manager: leading individuals and teams, motivation, decision making, negotiation, organizational culture and change.",
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "10:00", "11:50", "Wendeline Hartigan", 60, 51, { final: F.thu8 }),
      s("DIS", "A", "F", "10:00", "10:50", null, 30, 26),
      s("DIS", "A", "F", "12:00", "12:50", null, 30, 25),
      s("LEC", "B", "MW", "16:00", "17:50", "Wendeline Hartigan", 60, 29, { final: F.mon2 }),
      s("DIS", "B", "F", "14:00", "14:50", null, 60, 29),
    ],
  },
  {
    code: "ECON-203",
    title: "Principles of Microeconomics",
    units: 4,
    description:
      "Behavior of firms and consumers, functions of the price system, competition and monopoly, labor markets, poverty, government regulation, international trade, and the environment.",
    ge: ["C"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "08:00", "09:20", "Bartholomew Nkemelu", 200, 96, { final: F.wed8 }),
      s("DIS", "A", "Th", "09:00", "09:50", null, 50, 24),
      s("DIS", "A", "F", "11:00", "11:50", null, 50, 26),
      s("LEC", "B", "TTh", "14:00", "15:20", "Bartholomew Nkemelu", 200, 171, { final: F.tue2 }),
      s("DIS", "B", "W", "13:00", "13:50", null, 50, 46),
      s("DIS", "B", "F", "09:00", "09:50", null, 50, 41),
    ],
  },
  // ---- GE A: The Arts ----
  {
    code: "CTCS-190",
    title: "Introduction to Cinema",
    units: 4,
    description:
      "Gateway to the majors and minors in cinematic arts. Technique, aesthetics, criticism, and social implications of cinema. Lectures accompanied by screenings of appropriate films.",
    ge: ["A"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "T", "13:00", "16:50", "Camille Durand", 340, 331, { final: F.tue2 }),
      s("DIS", "A", "W", "10:00", "10:50", null, 25, 25),
      s("DIS", "A", "W", "15:00", "15:50", null, 25, 24),
      s("DIS", "A", "Th", "11:00", "11:50", null, 25, 22),
      s("DIS", "A", "F", "13:00", "13:50", null, 25, 19),
    ],
  },
  {
    code: "MUSC-102",
    title: "World Music",
    units: 4,
    description:
      "Exploration of music and cultures of the world. Engagement with international musicians, global issues, field work and musical diasporas in Los Angeles.",
    ge: ["A"],
    linkage: "single",
    sections: [
      s("LEC", null, "MW", "14:00", "15:50", "Rafael Montoya", 120, 73, { final: F.wed2 }),
      s("LEC", null, "TTh", "10:00", "11:50", "Rafael Montoya", 120, 102, { final: F.thu8 }),
    ],
  },
  {
    code: "THTR-125",
    title: "Text Studies for Production",
    units: 4,
    description:
      "Developing the skills of reading and understanding dramatic texts by exploring plays from different periods and the ways they are brought to the stage.",
    ge: ["A"],
    linkage: "single",
    sections: [
      s("LEC", null, "MW", "12:00", "13:50", "Beatrix Hollowell", 48, 30, { final: F.mon11 }),
      s("LEC", null, "TTh", "16:00", "17:50", "Beatrix Hollowell", 48, 12, { final: F.thu2 }),
    ],
  },
  // ---- GE B: Humanistic Inquiry ----
  {
    code: "PHIL-140",
    title: "Contemporary Moral and Social Issues",
    units: 4,
    description:
      "Critical study of controversial social issues such as abortion, capital punishment, affirmative action, free speech, technology and privacy, and economic justice.",
    ge: ["B"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "10:00", "11:20", "Julian Ashworth", 150, 88, { final: F.wed11 }),
      s("DIS", "A", "Th", "10:00", "10:50", null, 30, 18),
      s("DIS", "A", "Th", "14:00", "14:50", null, 30, 21),
      s("DIS", "A", "F", "10:00", "10:50", null, 30, 15),
    ],
  },
  {
    code: "ENGL-176",
    title: "Los Angeles: The City, the Novel, the Movie",
    units: 4,
    description:
      "Los Angeles as seen through the eyes of novelists and filmmakers: noir, Hollywood, immigration, freeways and sprawl, from Chandler to the present.",
    ge: ["B"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "11:00", "12:20", "Naomi Castellanos", 180, 139, { final: F.thu11 }),
      s("DIS", "A", "F", "09:00", "09:50", null, 30, 22),
      s("DIS", "A", "F", "11:00", "11:50", null, 30, 29),
      s("DIS", "A", "W", "12:00", "12:50", null, 30, 24),
    ],
  },
  {
    code: "CLAS-150",
    title: "The Greeks and the West",
    units: 4,
    description:
      "A historical and cultural survey of ancient Greece: myth, epic, tragedy, democracy, philosophy, and their afterlives in Western thought.",
    ge: ["B", "H"],
    linkage: "single",
    sections: [s("LEC", null, "MWF", "12:00", "12:50", "Desmond Achebe", 90, 41, { final: F.mon11 })],
  },
  // ---- GE C: Social Analysis ----
  {
    code: "PSYC-100",
    title: "Introduction to Psychology",
    units: 4,
    description:
      "Factors that influence human behavior, including learning, thinking, perception, motivation, and emotion; analysis of determinants of development, adjustment, and maladjustment.",
    ge: ["C"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "09:30", "10:50", "Yuki Tanabe", 300, 267, { final: F.thu8 }),
      s("DIS", "A", "M", "09:00", "09:50", null, 30, 28),
      s("DIS", "A", "M", "13:00", "13:50", null, 30, 30),
      s("DIS", "A", "W", "11:00", "11:50", null, 30, 26),
      s("LEC", "B", "MW", "15:30", "16:50", "Yuki Tanabe", 300, 143, { final: F.mon2 }),
      s("DIS", "B", "Th", "13:00", "13:50", null, 30, 14),
      s("DIS", "B", "F", "10:00", "10:50", null, 30, 12),
    ],
  },
  {
    code: "SOCI-200",
    title: "Introduction to Sociology",
    units: 4,
    description:
      "Basic concepts of sociology with special reference to group life, social institutions, inequality, cities, and social change.",
    ge: ["C"],
    linkage: "single",
    sections: [
      s("LEC", null, "TTh", "12:30", "13:50", "Fiona Gallagher-Reyes", 130, 59, { final: F.thu11 }),
      s("LEC", null, "MW", "17:00", "18:20", "Fiona Gallagher-Reyes", 130, 22, { final: F.mon2 }),
    ],
  },
  {
    code: "IR-210",
    title: "International Relations: Introductory Analysis",
    units: 4,
    description:
      "Comprehensive introduction to contending theoretical and analytical approaches; development of critical, evaluative, cognitive, and analytical competencies regarding historical and contemporary issues.",
    ge: ["C"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "10:00", "11:20", "Anton Vasquez", 160, 94, { final: F.wed11 }),
      s("DIS", "A", "F", "10:00", "10:50", null, 40, 23),
      s("DIS", "A", "F", "12:00", "12:50", null, 40, 25),
      s("DIS", "A", "Th", "16:00", "16:50", null, 40, 21),
    ],
  },
  // ---- GE D: Life Sciences ----
  {
    code: "BISC-104",
    title: "How the Body Works: Topics in Human Physiology",
    units: 4,
    description:
      "Structure and function of the human body, including the role of organ systems, tissues, and cells in normal function. Dysfunction and disease.",
    ge: ["D"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "14:00", "15:20", "Meredith Okafor", 200, 151, { final: F.tue2 }),
      s("LAB", "A", "M", "12:00", "13:50", null, 24, 24),
      s("LAB", "A", "W", "08:00", "09:50", null, 24, 13),
      s("LAB", "A", "F", "14:00", "15:50", null, 24, 17),
    ],
  },
  // ---- GE E: Physical Sciences ----
  {
    code: "ASTR-100",
    title: "The Universe",
    units: 4,
    description:
      "Survey of the universe: planets, satellites, comets, stars, nebulae, galaxies. Practical component includes planetarium and observing activities.",
    ge: ["E"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MWF", "10:00", "10:50", "Stellan Bergstrom", 240, 228, { final: F.wed11 }),
      s("LAB", "A", "T", "18:00", "19:50", null, 30, 29),
      s("LAB", "A", "W", "18:00", "19:50", null, 30, 28),
      s("LEC", "B", "TTh", "15:30", "16:50", "Stellan Bergstrom", 240, 119, { final: F.thu2 }),
      s("LAB", "B", "M", "16:00", "17:50", null, 30, 15),
      s("LAB", "B", "Th", "18:00", "19:50", null, 30, 14),
    ],
  },
  {
    code: "GEOL-105",
    title: "Planet Earth",
    units: 4,
    description:
      "Geologic structure and evolution of planet Earth. Principles of plate tectonics, rocks and minerals, processes of mountain building, continent and ocean formation, earthquakes, volcanism.",
    ge: ["E"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MWF", "09:00", "09:50", "Rosalind Pemberton", 150, 63, { final: F.fri8 }),
      s("LAB", "A", "T", "10:00", "11:50", null, 25, 9),
      s("LAB", "A", "Th", "14:00", "15:50", null, 25, 12),
    ],
  },
  // ---- GE F: Quantitative Reasoning ----
  {
    code: "LING-285",
    title: "Human Language and Technology",
    units: 4,
    description:
      "Study of human linguistic competence and technologies that simulate it. Grammar, parsing, text generation; semantics, pragmatics, sense disambiguation; phonetics, speech synthesis, speech recognition.",
    ge: ["F"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "12:30", "13:50", "Kwame Adjei", 100, 62, { final: F.thu11 }),
      s("DIS", "A", "F", "11:00", "11:50", null, 50, 30),
      s("DIS", "A", "W", "14:00", "14:50", null, 50, 32),
    ],
  },
  // ---- GE G: Citizenship in a Diverse World ----
  {
    code: "AMST-101",
    title: "Race and Class in Los Angeles",
    units: 4,
    description:
      "Analysis of race and the economic, political, gender, and social dimensions of contemporary Los Angeles including topics such as residential segregation, economic inequality, and city politics.",
    ge: ["G"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "MW", "12:00", "13:20", "Lucia Fontaine", 150, 132, { final: F.mon11 }),
      s("DIS", "A", "Th", "09:00", "09:50", null, 30, 27),
      s("DIS", "A", "Th", "13:00", "13:50", null, 30, 28),
      s("DIS", "A", "F", "12:00", "12:50", null, 30, 25),
    ],
  },
  // ---- GE H: Traditions and Historical Foundations ----
  {
    code: "HIST-102",
    title: "Medieval People: Early Europe and Its Neighbors, 400-1500",
    units: 4,
    description:
      "Legacy of the Middle Ages: political, social, and cultural developments in Europe and the Mediterranean world between the fall of Rome and the Renaissance.",
    ge: ["H"],
    linkage: "coded",
    sections: [
      s("LEC", "A", "TTh", "09:30", "10:50", "Henrik Vandermeer", 120, 48, { final: F.thu8 }),
      s("DIS", "A", "W", "09:00", "09:50", null, 30, 12),
      s("DIS", "A", "F", "13:00", "13:50", null, 30, 11),
    ],
  },
  {
    code: "REL-135",
    title: "Religions of China, Japan and Korea",
    units: 4,
    description:
      "History, teachings, and practices of East Asian religious traditions including Confucianism, Daoism, Buddhism, Shinto and shamanism, and their place in modern life.",
    ge: ["H"],
    linkage: "single",
    sections: [s("LEC", null, "MW", "14:00", "15:20", "Isadora Quint", 70, 33, { final: F.wed2 })],
  },
  // ---- Electives ----
  {
    code: "ITP-303",
    title: "Full-Stack Web Development",
    units: 4,
    description:
      "Design and build dynamic, data-driven web applications: front-end frameworks, server-side programming, databases, APIs, and deployment.",
    linkage: "single",
    sections: [
      s("LEC-LAB", null, "TTh", "14:00", "15:50", "Oscar Valdivia", 40, 36, { final: F.tue2 }),
      s("LEC-LAB", null, "MW", "18:00", "19:50", "Oscar Valdivia", 40, 17, { final: F.mon2 }),
    ],
  },
  {
    code: "CTIN-190",
    title: "Introduction to Interactive Entertainment",
    units: 4,
    description:
      "Critical vocabulary and historical perspective for analyzing and understanding experiences with interactive entertainment; students imagine and articulate their own game ideas.",
    linkage: "coded",
    sections: [
      s("LEC", "A", "W", "13:00", "15:50", "Thea Rosenquist", 120, 97, { final: F.wed2 }),
      s("LAB", "A", "Th", "17:00", "17:50", null, 30, 26),
      s("LAB", "A", "F", "11:00", "11:50", null, 30, 22),
    ],
  },
  {
    code: "DSCI-250",
    title: "Introduction to Data Science",
    units: 4,
    description:
      "Fundamentals of data science: representing, storing, and manipulating data; exploratory analysis, visualization, basic statistics and machine learning with Python.",
    linkage: "single",
    sections: [
      s("LEC", null, "MW", "10:00", "11:50", null, 80, 44, { final: F.wed11 }),
      s("LEC", null, "", "", "", null, 80, 31, { online: true, notes: "DEN@Viterbi online section. Meeting time to be announced." }),
    ],
  },
  {
    code: "PHED-120",
    title: "Yoga",
    units: 1,
    description:
      "Introduction to meditation, breathing techniques and postures as a means toward relaxation; increase muscle flexibility; understanding of basic anatomy and nutritional guidelines.",
    linkage: "single",
    sections: [
      s("LEC", null, "MW", "08:00", "08:50", null, 35, 30),
      s("LEC", null, "TTh", "13:00", "13:50", null, 35, 35),
      s("LEC", null, "F", "09:00", "10:50", null, 35, 12),
    ],
  },
];

const DAY_TOKENS: Record<string, Day> = { M: "Mon", T: "Tue", W: "Wed", Th: "Thu", F: "Fri", Sa: "Sat", Su: "Sun" };

function parseDays(spec: string): Day[] {
  return (spec.match(/Th|Sa|Su|M|T|W|F/g) ?? []).map((tok) => DAY_TOKENS[tok]);
}

function build(): TermData {
  const courses: Record<string, Course> = {};
  const sections: Record<string, Section> = {};
  const rmp: Record<string, RmpTeacher> = {};
  const rmpIdByName = new Map<string, string>();

  Object.entries(RATINGS).forEach(([name, [avg, difficulty, count, wouldTakeAgain, department]], i) => {
    const legacyId = String(2100000 + i * 137);
    const [first, ...rest] = name.split(" ");
    rmp[legacyId] = { legacyId, first, last: rest.join(" "), department, avg, difficulty, count, wouldTakeAgain };
    rmpIdByName.set(name, legacyId);
  });

  let nextId = 30100;
  for (const spec of COURSES) {
    const [min, max] = Array.isArray(spec.units) ? spec.units : [spec.units, spec.units];
    const sectionIds: string[] = [];
    for (const sec of spec.sections) {
      const id = String(nextId);
      nextId += 7;
      const instructors: Instructor[] = [];
      if (sec.instructor) {
        const [first, ...rest] = sec.instructor.split(" ");
        const rmpId = rmpIdByName.get(sec.instructor) ?? null;
        instructors.push({ first, last: rest.join(" "), rmpId, rmpMatch: rmpId ? RATINGS[sec.instructor][5] : null });
      }
      const isLecture = sec.type.startsWith("LEC");
      sections[id] = {
        id,
        courseCodes: [spec.code, ...(sec.alsoListedAs ?? [])],
        type: sec.type,
        linkCode: sec.link,
        session: "001",
        units: isLecture ? { min, max } : { min: 0, max: 0 },
        dClearance: sec.dClearance ?? false,
        seats: { registered: sec.registered, total: sec.total },
        isFull: sec.registered >= sec.total,
        online: sec.online ?? false,
        campus: sec.online ? null : "UPC",
        instructors,
        meetings: sec.days ? [{ days: parseDays(sec.days), start: sec.start, end: sec.end }] : [],
        final: sec.final ? { date: sec.final[0], start: sec.final[1], end: sec.final[2] } : null,
        notes: sec.notes ?? null,
        webregUrl: `https://webreg.usc.edu/Courses?Course=${encodeURIComponent(spec.code)}`,
      };
      sectionIds.push(id);
    }
    courses[spec.code] = {
      code: spec.code,
      title: spec.title,
      description: spec.description,
      units: { min, max },
      ge: spec.ge ?? [],
      crossListedWith: spec.crossListedWith ?? [],
      prereqText: spec.prereq ?? null,
      linkage: spec.linkage ?? "single",
      sectionIds,
    };
  }

  // Cross-listed twin: same sections under the other code (contract: cross-listed sections = same section).
  const ml = courses["CSCI-467"];
  courses["EE-467"] = { ...ml, code: "EE-467", crossListedWith: ["CSCI-467"] };

  return { term: { code: TERM_CODE, name: "Spring 2027", scrapedAt: "2026-11-14T08:00:00.000Z" }, courses, sections, rmp };
}

export const SAMPLE_TERM: TermData = build();
export const SAMPLE_INDEX = { terms: [SAMPLE_TERM.term] };
