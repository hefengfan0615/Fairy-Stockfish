/*
  Stockfish, a UCI chess playing engine derived from Glaurung 2.1
  Copyright (C) 2004-2022 The Stockfish developers (see AUTHORS file)

  Stockfish is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  Stockfish is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

#include <iostream>
#include <cstdio>
#include <sstream>

#include "bitboard.h"
#include "endgame.h"
#include "position.h"
#include "psqt.h"
#include "search.h"
#include "syzygy/tbprobe.h"
#include "thread.h"
#include "tt.h"
#include "uci.h"

#include "piece.h"
#include "variant.h"
#include "xboard.h"


using namespace Stockfish;

#ifdef __EMSCRIPTEN__
// Emscripten: bypass stdin entirely. Commands are sent via _command() from JS,
// keeping the main thread free to process proxied search output.
static Position* emPos = nullptr;
static StateListPtr emStates;
static std::vector<Move> emBanmoves;
static int emArgc = 1;

extern "C" {

void command(const char* cmd) {
    UCI::process_command(*emPos, emStates, emBanmoves, std::string(cmd), emArgc);
}

} // extern "C"
#endif

int main(int argc, char* argv[]) {

  std::cout << std::unitbuf;
  setvbuf(stdout, NULL, _IONBF, 0);
  std::cout << engine_info() << std::endl;

  pieceMap.init();
  variants.init();
  CommandLine::init(argc, argv);
  UCI::init(Options);
  Tune::init();
  PSQT::init(variants.find(Options["UCI_Variant"])->second);
  Bitboards::init();
  Position::init();
  Bitbases::init();
  Endgames::init();
  Threads.set(size_t(Options["Threads"]));
  Search::clear(); // After threads are up
  Eval::NNUE::init();

#ifdef __EMSCRIPTEN__
  // Initialize globals for _command() processing
  emPos = new Position();
  emStates = StateListPtr(new std::deque<StateInfo>(1));
  assert(variants.find(Options["UCI_Variant"])->second != nullptr);
  emPos->set(variants.find(Options["UCI_Variant"])->second,
             variants.find(Options["UCI_Variant"])->second->startFen,
             false, &emStates->back(), Threads.main());
  XBoard::stateMachine = new XBoard::StateMachine(*emPos, emStates);

  // Check environment for variants.ini file
  char *envVariantPath = std::getenv("FAIRY_STOCKFISH_VARIANT_PATH");
  if (envVariantPath != NULL)
      Options["VariantPath"] = std::string(envVariantPath);

  // Do NOT call UCI::loop() - it would block on getline() and prevent
  // proxied search output from being processed. Commands come via _command().
#else
  UCI::loop(argc, argv);
#endif

  #ifdef __EMSCRIPTEN__
  // Do NOT destroy threads or state machine - they need to stay alive
  // for _command() processing. The runtime stays alive (EXIT_RUNTIME=0).
#else
  Threads.set(0);
  variants.clear_all();
  pieceMap.clear_all();
  delete XBoard::stateMachine;
#endif
  return 0;
}
