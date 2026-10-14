// red-1: authored mission data for the web01 training incident.
// Export: RED_1. Install in data/missions/red-1.js.
// Requires the red-handoff-v1 consumer contract described in red-missions-integration.md.
// The current legacy matcher ignores these guards: do not register until supported.
// This module does not execute commands, mutate guests, make requests, or grant rewards.
// Keep briefing, hints and command output here; share only the separate handoff card.
import { VMS } from '../commands.js';

// Deep-freeze only this finite authored graph, never visitor input or stored objects.
function freezeData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export const RED_1 = freezeData({
  "id": "red-1",
  "ticket": "1043",
  "seat": "parrot01",
  "targets": [
    "web01"
  ],
  "title": "Knock, don't assume",
  "from": "Lab Ops",
  "durationMinutes": 10,
  "contract": "red-handoff-v1",
  "requires": [
    "m-ws01-baseline-done"
  ],
  "scenario": "web01",
  "provides": [
    "R1-a",
    "R1-b",
    "R1-c"
  ],
  "briefing": [
    "Lab Ops needs a clear picture of what web01 exposes. Work from parrot01; web01 is your only target.",
    "Inspect its web and SSH services, follow the maintenance link, and make the two named training login attempts: admin and operator. No password is requested and no remote shell opens.",
    "Record what answered and what refused you. Leave the server unchanged for Red 2. A version banner or a refused login is an observation, not proof that you own the server."
  ],
  "startState": {
    "mode": "new-run-or-resume",
    "targetRunning": true,
    "state": {
      "status": "baseline",
      "publicRestore": "enabled"
    },
    "preserveEvidence": true
  },
  "objectives": [
    {
      "id": "r1-scope",
      "text": "cat /home/operator/red-1-ticket.txt",
      "do": "cat /home/operator/red-1-ticket.txt",
      "see": "Permitted target, source seat, and the two named account checks.",
      "ticks": "Successful read of the authored ticket on parrot01.",
      "teaches": "Scope before action.",
      "dependsOn": [],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "parrot01"
        ],
        "commands": [
          "cat ~/red-1-ticket.txt"
        ]
      },
      "hints": [
        "Read the assignment first.",
        "The ticket is in your simulated home directory.",
        "cat /home/operator/red-1-ticket.txt"
      ]
    },
    {
      "id": "r1-services",
      "text": "nmap -sV -p 22,80,443 web01",
      "do": "nmap -sV -p 22,80,443 web01",
      "see": "The three authored services are open.",
      "ticks": "Successful web01 service scan from the mission seat.",
      "teaches": "Inventory services; do not infer a vulnerability from a banner.",
      "dependsOn": [
        "r1-scope"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "nmap -sV -p 22,80,443 web01.lab.example"
        ]
      },
      "hints": [
        "Find what answers on the assigned server.",
        "Scan the three ports named in the ticket with service detection.",
        "nmap -sV -p 22,80,443 web01"
      ]
    },
    {
      "id": "r1-web",
      "text": "curl https://web01.lab.example/",
      "do": "curl https://web01.lab.example/",
      "see": "The working site and its maintenance link.",
      "ticks": "Successful root GET creates R1-a evidence.",
      "teaches": "A web response is observable activity.",
      "dependsOn": [
        "r1-services"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "curl https://web01.lab.example/"
        ],
        "evidence": [
          "e-web01-http-parrot01"
        ]
      },
      "hints": [
        "Look at what the web service serves.",
        "Fetch the home page with curl.",
        "curl https://web01.lab.example/"
      ]
    },
    {
      "id": "r1-maintenance",
      "text": "curl https://web01.lab.example/maintenance/",
      "do": "curl https://web01.lab.example/maintenance/",
      "see": "A retired-looking maintenance feature is still exposed.",
      "ticks": "Successful maintenance GET creates optional R1-c evidence.",
      "teaches": "Follow an actual clue rather than guess arbitrary endpoints.",
      "dependsOn": [
        "r1-web"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "curl https://web01.lab.example/maintenance/"
        ],
        "evidence": [
          "e-web01-maintenance-page-parrot01"
        ]
      },
      "hints": [
        "Follow the link left on that page.",
        "The old feature is under /maintenance/.",
        "curl https://web01.lab.example/maintenance/"
      ]
    },
    {
      "id": "r1-admin",
      "text": "ssh admin@web01",
      "do": "ssh admin@web01",
      "see": "Authentication denied; no remote prompt.",
      "ticks": "denied, reason auth, with the existing-account attempt in R1-b.",
      "teaches": "A real account can be targeted without authentication succeeding.",
      "dependsOn": [
        "r1-maintenance"
      ],
      "when": {
        "match": "all",
        "outcome": "denied",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "ssh admin@web01.lab.example"
        ],
        "evidence": [
          "e-web01-ssh-existing-denied-admin-parrot01"
        ],
        "reason": "auth"
      },
      "hints": [
        "Check the first account named in the ticket.",
        "Use SSH with web01's admin account; no password is needed for this scripted refusal.",
        "ssh admin@web01"
      ]
    },
    {
      "id": "r1-operator",
      "text": "ssh operator@web01",
      "do": "ssh operator@web01",
      "see": "Authentication denied again; the target log identifies an invalid account.",
      "ticks": "denied, reason auth, with the invalid-account attempt in R1-b.",
      "teaches": "An account valid on one host need not exist on another.",
      "dependsOn": [
        "r1-admin"
      ],
      "when": {
        "match": "all",
        "outcome": "denied",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "ssh operator@web01.lab.example"
        ],
        "evidence": [
          "e-web01-ssh-invalid-denied-operator-parrot01"
        ],
        "reason": "auth"
      },
      "hints": [
        "Your local username may not exist on the server.",
        "Make the ticket's second named check.",
        "ssh operator@web01"
      ]
    },
    {
      "id": "r1-map",
      "text": "cat /home/operator/lab-hosts.txt",
      "do": "cat /home/operator/lab-hosts.txt",
      "see": "parrot01 ↔ .10, web01 ↔ .50, ubuntu-blue ↔ .30, plus the other authored hosts.",
      "ticks": "Successful read of the canonical lab host list.",
      "teaches": "Understand the source/target identities Blue will correlate.",
      "dependsOn": [
        "r1-operator"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "parrot01"
        ],
        "commands": [
          "cat ~/lab-hosts.txt"
        ]
      },
      "hints": [
        "Keep source and destination straight.",
        "The lab host list maps reserved addresses to VMs.",
        "cat /home/operator/lab-hosts.txt"
      ]
    },
    {
      "id": "r1-report",
      "text": "Save the fixed-choice finding as ~/red-1-findings.txt through the guest report/editor flow.",
      "do": "Save the fixed-choice finding as ~/red-1-findings.txt through the guest report/editor flow.",
      "see": "Target, source, responding services, tried accounts, two denied outcomes, and maintenance exposure.",
      "ticks": "Required choices validated and the report saved on parrot01.",
      "teaches": "State observations and limits.",
      "dependsOn": [
        "r1-map"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "parrot01"
        ],
        "saved": [
          "home/operator/red-1-findings.txt"
        ],
        "report": "red-1"
      },
      "hints": [
        "Write what you observed, including the refusals.",
        "Use the Red 1 finding form.",
        "Select web01, parrot01, admin and operator, “both denied,” then save red-1-findings.txt."
      ]
    }
  ],
  "completeWhen": {
    "allObjectives": true,
    "state": {
      "status": "baseline",
      "publicRestore": "enabled"
    },
    "evidence": [
      "e-web01-http-parrot01",
      "e-web01-maintenance-page-parrot01",
      "e-web01-ssh-existing-denied-admin-parrot01",
      "e-web01-ssh-invalid-denied-operator-parrot01"
    ],
    "report": "red-1"
  },
  "report": {
    "id": "red-1",
    "seat": "parrot01",
    "path": "home/operator/red-1-findings.txt",
    "title": "Red 1 findings: web01",
    "questions": [
      {
        "id": "source",
        "prompt": "Which VM made these requests?",
        "options": [
          {
            "value": "parrot01",
            "label": "parrot01"
          },
          {
            "value": "web01",
            "label": "web01"
          },
          {
            "value": "ubuntu-blue",
            "label": "ubuntu-blue"
          }
        ],
        "answer": [
          "parrot01"
        ],
        "multiple": false
      },
      {
        "id": "target",
        "prompt": "Which VM was the target?",
        "options": [
          {
            "value": "parrot01",
            "label": "parrot01"
          },
          {
            "value": "web01",
            "label": "web01"
          },
          {
            "value": "ubuntu-blue",
            "label": "ubuntu-blue"
          }
        ],
        "answer": [
          "web01"
        ],
        "multiple": false
      },
      {
        "id": "services",
        "prompt": "Which ports answered?",
        "options": [
          {
            "value": "22",
            "label": "22 / SSH"
          },
          {
            "value": "80",
            "label": "80 / HTTP"
          },
          {
            "value": "443",
            "label": "443 / HTTPS"
          },
          {
            "value": "3389",
            "label": "3389 / RDP"
          }
        ],
        "answer": [
          "22",
          "80",
          "443"
        ],
        "multiple": true
      },
      {
        "id": "accounts",
        "prompt": "Which accounts did you try?",
        "options": [
          {
            "value": "admin",
            "label": "admin"
          },
          {
            "value": "operator",
            "label": "operator"
          },
          {
            "value": "root",
            "label": "root"
          }
        ],
        "answer": [
          "admin",
          "operator"
        ],
        "multiple": true
      },
      {
        "id": "ssh",
        "prompt": "What did the SSH attempts establish?",
        "options": [
          {
            "value": "denied",
            "label": "Both authentication attempts were denied"
          },
          {
            "value": "shell",
            "label": "A remote shell opened"
          }
        ],
        "answer": [
          "denied"
        ],
        "multiple": false
      },
      {
        "id": "exposure",
        "prompt": "Which feature was still exposed?",
        "options": [
          {
            "value": "maintenance",
            "label": "The legacy maintenance page"
          },
          {
            "value": "root",
            "label": "A root shell"
          }
        ],
        "answer": [
          "maintenance"
        ],
        "multiple": false
      }
    ],
    "requiresAllAnswers": true,
    "evidence": [
      "e-web01-http-parrot01",
      "e-web01-maintenance-page-parrot01",
      "e-web01-ssh-existing-denied-admin-parrot01",
      "e-web01-ssh-invalid-denied-operator-parrot01"
    ]
  },
  "reward": {
    "unlock": null,
    "nextMission": "red-2"
  },
  "closing": "Recorded: web01 answered on its web services and refused both named SSH attempts. The maintenance feature remains exposed. Continue with Red 2.",
  "content": {
    "files": [
      {
        "vm": "parrot01",
        "path": "home/operator/red-1-ticket.txt",
        "content": "Lab Ops needs a clear picture of what web01 exposes. Work from parrot01; web01 is your only target.\n\nInspect its web and SSH services, follow the maintenance link, and make the two named training login attempts: admin and operator. No password is requested and no remote shell opens.\n\nRecord what answered and what refused you. Leave the server unchanged for Red 2. A version banner or a refused login is an observation, not proof that you own the server.\n"
      },
      {
        "vm": "parrot01",
        "path": "home/operator/lab-hosts.txt",
        "content": VMS.map((vm) => `${vm.ip} ${vm.host} (${vm.id})`).join('\n') + '\n'
      }
    ],
    "pages": [
      {
        "id": "web01.lab.example/maintenance/",
        "vm": "web01",
        "title": "Legacy maintenance",
        "blocks": [
          {
            "t": "h1",
            "text": "Legacy maintenance (simulated)"
          },
          {
            "t": "p",
            "text": "This restore workflow should have been retired. Its public restore setting is still enabled in this training scenario."
          },
          {
            "t": "p",
            "text": "The only training fixture changes /status.txt. Inspect it first: lab-restore preview web01."
          },
          {
            "t": "p",
            "text": "The helper is part of this simulation. No upload, archive, script, credential, or other target is accepted."
          }
        ]
      }
    ],
    "homeLink": {
      "vm": "web01",
      "to": "web01.lab.example/maintenance/",
      "text": "Legacy maintenance"
    }
  },
  "handoff": [
    {
      "slot": "R1-a",
      "evidence": [
        "e-web01-http-parrot01"
      ]
    },
    {
      "slot": "R1-b",
      "evidence": [
        "e-web01-ssh-existing-denied-admin-parrot01",
        "e-web01-ssh-invalid-denied-operator-parrot01"
      ]
    },
    {
      "slot": "R1-c",
      "evidence": [
        "e-web01-maintenance-page-parrot01"
      ]
    }
  ]
});
